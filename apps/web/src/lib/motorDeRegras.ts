import type { QuestionarioProjeto, ServiceCategory } from "@croqui/shared";
import type { AmbienteDetectado, AncoraAmbiente, LimitesPlanta } from "./detectarAmbientes";

/**
 * Motor de regras (Fase 6.1) - captura o criterio de posicionamento descrito
 * pelo usuario (entrevista de 08/09/2026) em regras explicitas, aplicadas
 * sobre os ambientes que o app ja detecta sozinho (ver detectarAmbientes.ts).
 *
 * Isso e so um PONTO DE PARTIDA: toda sugestao vira um ponto normal, editavel
 * e removivel no editor - nunca e "definitivo". Regras marcadas com
 * `revisar: true` sao as que o proprio usuario disse que "depende de analise"
 * (ex: piscina pode ser bookshelf ou caixa externa) - a sugestao usa um
 * padrao razoavel, mas o usuario deve conferir.
 */

export interface SugestaoPonto {
  simboloId: string;
  quantidade: number;
  ambiente: string;
  posX: number;
  posY: number;
  limites?: LimitesPlanta;
  ancoras?: AncoraAmbiente[];
  observacao?: string;
  revisar?: boolean;
}

function normalizar(texto: string): string {
  return Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const codigo = ch.codePointAt(0) ?? 0;
      return codigo < 0x0300 || codigo > 0x036f;
    })
    .join("")
    .toLowerCase();
}

interface ItemGerado {
  simboloId: string;
  quantidade: number;
  observacao?: string;
  revisar?: boolean;
}

const DISTANCIA_ENTRE_AMBIENTES_DO_MESMO_CONJUNTO = 360;
const TERMOS_CIRCULACAO_AP = /(^| )(hall|corredor|circulacao|entrada|vestibulo|foyer|distribuicao|escada|passagem)($| )/;

function distanciaEntre(a: AmbienteDetectado, b: AmbienteDetectado): number {
  return Math.hypot(a.posX - b.posX, a.posY - b.posY);
}

/**
 * Uma mesma folha pode trazer mais de um desenho/planta separado. Agrupar os
 * rótulos evita escolher um AP usando o ambiente do meio da lista quando esse
 * ambiente pertence a outro desenho da folha.
 */
function agruparAmbientes(ambientes: AmbienteDetectado[]): AmbienteDetectado[][] {
  const grupos: AmbienteDetectado[][] = [];
  const visitados = new Set<number>();

  for (let inicio = 0; inicio < ambientes.length; inicio++) {
    if (visitados.has(inicio)) continue;
    const grupo: AmbienteDetectado[] = [];
    const fila = [inicio];
    visitados.add(inicio);

    while (fila.length > 0) {
      const atual = fila.shift();
      if (atual === undefined) continue;
      grupo.push(ambientes[atual]);

      for (let candidato = 0; candidato < ambientes.length; candidato++) {
        if (visitados.has(candidato)) continue;
        if (distanciaEntre(ambientes[atual], ambientes[candidato]) > DISTANCIA_ENTRE_AMBIENTES_DO_MESMO_CONJUNTO) {
          continue;
        }
        visitados.add(candidato);
        fila.push(candidato);
      }
    }

    grupos.push(grupo);
  }

  return grupos.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const areaA = a.reduce((soma, ambiente) => soma + (ambiente.areaM2 ?? 0), 0);
    const areaB = b.reduce((soma, ambiente) => soma + (ambiente.areaM2 ?? 0), 0);
    return areaB - areaA;
  });
}

function centroDosAmbientes(ambientes: AmbienteDetectado[]): { posX: number; posY: number } {
  return {
    posX: ambientes.reduce((soma, ambiente) => soma + ambiente.posX, 0) / ambientes.length,
    posY: ambientes.reduce((soma, ambiente) => soma + ambiente.posY, 0) / ambientes.length,
  };
}

function limitesDoGrupo(ambientes: AmbienteDetectado[]): LimitesPlanta | undefined {
  return ambientes
    .map((ambiente) => ambiente.limites)
    .filter((limites): limites is LimitesPlanta => limites !== undefined)
    .sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY))[0];
}

function escolherAmbientesDeCirculacaoParaAp(ambientes: AmbienteDetectado[]): AmbienteDetectado[] {
  const grupoPrincipal = agruparAmbientes(ambientes)[0] ?? ambientes;
  return grupoPrincipal
    .filter((ambiente) => TERMOS_CIRCULACAO_AP.test(normalizar(ambiente.nome)))
    .sort((a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0));
}

function centroDoAmbienteParaAp(ambiente: AmbienteDetectado, ambientes: AmbienteDetectado[]): { x: number; y: number } {
  const zona = calcularZonaDoAmbiente(ambiente, ambientes, ambiente.limites);
  return zona ? centroDaRegiao(zona) : { x: ambiente.posX, y: ambiente.posY };
}

function escolherPosicaoDoAp(ambientes: AmbienteDetectado[]): { posX: number; posY: number } {
  const circulacao = escolherAmbientesDeCirculacaoParaAp(ambientes)[0];
  if (circulacao) {
    const centro = centroDoAmbienteParaAp(circulacao, ambientes);
    return { posX: centro.x, posY: centro.y };
  }
  const grupoPrincipal = agruparAmbientes(ambientes)[0] ?? ambientes;
  return centroDosAmbientes(grupoPrincipal);
}

function escolherPosicaoDoQuadro(ambientes: AmbienteDetectado[]): {
  posX: number;
  posY: number;
  referencia: string | null;
} {
  const candidatoTecnico = ambientes.find((ambiente) =>
    /quadro|el[eé]tric|entrada|hall|circula[cç][aã]o|servi[cç]o|lavanderia|garagem/i.test(ambiente.nome)
  );

  if (candidatoTecnico) {
    return { posX: candidatoTecnico.posX, posY: candidatoTecnico.posY, referencia: candidatoTecnico.nome };
  }

  const grupoPrincipal = agruparAmbientes(ambientes)[0] ?? ambientes;
  const centro = centroDosAmbientes(grupoPrincipal);
  return { ...centro, referencia: null };
}

interface RegraAmbiente {
  nome: string;
  categoriaNecessaria: ServiceCategory;
  testar: (nomeNormalizado: string) => boolean;
  gerar: (ambiente: AmbienteDetectado) => ItemGerado[];
}

// Regras por tipo de ambiente. A ordem nao importa - todas as que baterem se
// acumulam (ex: sala pode levar rede E multiroom, sao regras diferentes).
const REGRAS_AMBIENTE: RegraAmbiente[] = [
  {
    nome: "Quarto/suite - audio",
    categoriaNecessaria: "audio",
    testar: (n) => (/quarto|dormitorio|suite/.test(n)) && !/closet|banho|banheiro/.test(n),
    gerar: () => [{ simboloId: "caixa-embutir", quantidade: 2, observacao: "nos pés da cama" }],
  },
  {
    nome: "Banheiro master",
    categoriaNecessaria: "audio",
    testar: (n) => /(banho|banheiro).*master|master.*(banho|banheiro)/.test(n),
    gerar: () => [{ simboloId: "caixa-embutir", quantidade: 1 }],
  },
  {
    nome: "Closet",
    categoriaNecessaria: "audio",
    testar: (n) => /closet/.test(n),
    gerar: () => [{ simboloId: "caixa-embutir", quantidade: 1 }],
  },
  {
    nome: "Home theater / cinema - audio",
    categoriaNecessaria: "audio",
    testar: (n) => /\bhome\b|cinema|theater/.test(n),
    gerar: () => [
      { simboloId: "caixa-embutir", quantidade: 5, observacao: "sistema 5.1" },
      { simboloId: "subwoofer", quantidade: 1, observacao: "sistema 5.1" },
      { simboloId: "receiver", quantidade: 1 },
    ],
  },
  {
    nome: "Area externa / piscina - audio",
    categoriaNecessaria: "audio",
    testar: (n) => /piscina|area.*(externa|descoberta)|jardim|varanda/.test(n),
    gerar: () => [
      {
        simboloId: "caixa-outdoor-sauna",
        quantidade: 1,
        observacao: "confirmar: bookshelf ou caixa externa, depende do local",
        revisar: true,
      },
    ],
  },
  {
    nome: "Quarto/suite - rede",
    categoriaNecessaria: "rede",
    testar: (n) => (/quarto|dormitorio|suite/.test(n)) && !/closet|banho|banheiro/.test(n),
    gerar: () => [{ simboloId: "ponto-de-rede", quantidade: 2 }],
  },
  {
    nome: "Sala - rede",
    categoriaNecessaria: "rede",
    testar: (n) => /^sala|estar|living|\bhome\b|cinema/.test(n),
    gerar: () => [
      {
        simboloId: "ponto-de-rede",
        quantidade: 3,
        observacao: "4 se este ambiente também tiver som",
        revisar: true,
      },
    ],
  },
  {
    nome: "Gourmet - rede",
    categoriaNecessaria: "rede",
    testar: (n) => /gourmet/.test(n),
    gerar: () => [{ simboloId: "ponto-de-rede", quantidade: 2 }],
  },
  {
    nome: "Escritorio - rede",
    categoriaNecessaria: "rede",
    testar: (n) => /escritorio|office/.test(n),
    gerar: () => [
      {
        simboloId: "ponto-de-rede",
        quantidade: 3,
        observacao: "1 ponto para cada computador + 1 ponto para possivel impressora",
      },
    ],
  },
  {
    nome: "Sala - multiroom",
    categoriaNecessaria: "audio",
    testar: (n) => /^sala|estar|living/.test(n),
    gerar: () => [{ simboloId: "multiroom", quantidade: 1 }],
  },
];

/** Sugestoes de equipamento pra UM ambiente detectado. */
export function sugerirParaAmbiente(
  ambiente: AmbienteDetectado,
  servicos: ServiceCategory[]
): SugestaoPonto[] {
  const nomeNormalizado = normalizar(ambiente.nome);
  const sugestoes: SugestaoPonto[] = [];

  for (const regra of REGRAS_AMBIENTE) {
    if (!servicos.includes(regra.categoriaNecessaria)) continue;
    if (!regra.testar(nomeNormalizado)) continue;
    for (const item of regra.gerar(ambiente)) {
      sugestoes.push({
        ...item,
        ambiente: ambiente.nome,
        posX: ambiente.posX,
        posY: ambiente.posY,
        limites: ambiente.limites,
        ancoras: ambiente.ancoras,
      });
    }
  }

  return sugestoes;
}

function ehEscritorio(ambiente?: AmbienteDetectado): boolean {
  return ambiente ? /escritorio|office/.test(normalizar(ambiente.nome)) : false;
}

/**
 * Sugestoes que valem pro andar inteiro (planta), nao um ambiente especifico -
 * Unifi AP (por cobertura) e quadro de automacao (por andar).
 */
export function sugerirParaAndar(
  ambientes: AmbienteDetectado[],
  servicos: ServiceCategory[]
): SugestaoPonto[] {
  if (ambientes.length === 0) return [];
  const sugestoes: SugestaoPonto[] = [];
  const grupoPrincipal = agruparAmbientes(ambientes)[0] ?? ambientes;
  const limitesGrupoPrincipal = limitesDoGrupo(grupoPrincipal);
  const posReferencia = escolherPosicaoDoAp(ambientes);

  if (servicos.includes("rede")) {
    const areaTotal = ambientes.reduce((soma, a) => soma + (a.areaM2 ?? 0), 0);
    // Unifi LR cobre ~160m² no ideal; considerando perda de sinal por
    // paredes/lajes, uso ~120m² como limiar pra precisar de um segundo AP.
    const quantidade = areaTotal > 120 ? 2 : 1;
    sugestoes.push({
      simboloId: "unifi-ap",
      quantidade,
      ambiente: "cobertura do andar",
      posX: posReferencia.posX,
      posY: posReferencia.posY,
      limites: limitesGrupoPrincipal,
      observacao: (() => {
        const circulacao = escolherAmbientesDeCirculacaoParaAp(ambientes)[0];
        return circulacao
          ? `~${Math.round(areaTotal)}m² detectados no conjunto principal - priorizar circulação em "${circulacao.nome}"; confirmar cobertura`
          : `~${Math.round(areaTotal)}m² detectados no conjunto principal - confirmar posição de melhor cobertura`;
      })(),
      revisar: true,
    });
  }

  if (servicos.includes("automacao")) {
    const posQuadro = escolherPosicaoDoQuadro(ambientes);
    sugestoes.push({
      simboloId: "quadro-automacao",
      quantidade: 1,
      ambiente: posQuadro.referencia ?? "posição estimada do quadro elétrico",
      posX: posQuadro.posX,
      posY: posQuadro.posY,
      limites: ambientes.find((ambiente) => ambiente.nome === posQuadro.referencia)?.limites ?? limitesGrupoPrincipal,
      observacao: posQuadro.referencia
        ? `referência em "${posQuadro.referencia}" - confirmar posição do quadro elétrico`
        : "posição estimada no conjunto principal - posicionar perto do quadro elétrico real",
      revisar: true,
    });
  }

  return sugestoes;
}

function encontrarAmbienteConfigurado(
  ambientes: AmbienteDetectado[],
  nome: string,
  posX?: number,
  posY?: number
): AmbienteDetectado | undefined {
  return ambientes
    .filter((ambiente) => ambiente.nome === nome)
    .sort((a, b) => {
      const distanciaA = posX === undefined || posY === undefined ? 0 : Math.hypot(a.posX - posX, a.posY - posY);
      const distanciaB = posX === undefined || posY === undefined ? 0 : Math.hypot(b.posX - posX, b.posY - posY);
      return distanciaA - distanciaB;
    })[0];
}

/** Gera o croqui somente a partir das respostas confirmadas no briefing. */
export function sugerirPeloBriefing(
  ambientes: AmbienteDetectado[],
  questionario: QuestionarioProjeto,
  plantaId?: string
): SugestaoPonto[] {
  const sugestoes: SugestaoPonto[] = [];

  for (const ambiente of ambientes) {
    const configuracao = questionario.ambientes?.find(
      (item) =>
        (item.plantaId === undefined || item.plantaId === plantaId) &&
        item.nome === ambiente.nome &&
        Math.hypot(item.posX - ambiente.posX, item.posY - ambiente.posY) < 100
    );
    if (!configuracao) continue;

    const quantidadeCaixas = ehQuarto(ambiente) && configuracao.caixasSom > 0 ? 2 : configuracao.caixasSom;
    if (questionario.servicos.includes("audio") && quantidadeCaixas > 0) {
      sugestoes.push({
        simboloId: configuracao.tipoAudio === "bluetooth" ? "caixa-embutir-bluetooth" : "caixa-embutir",
        quantidade: quantidadeCaixas,
        ambiente: ambiente.nome,
        posX: ambiente.posX,
        posY: ambiente.posY,
        limites: ambiente.limites,
        ancoras: ambiente.ancoras,
        observacao: ehQuarto(ambiente) ? "nos pés da cama" : undefined,
      });
    }

    if (questionario.servicos.includes("audio") && configuracao.tipoAudio !== "nenhum" && configuracao.tipoAudio !== "bluetooth") {
      sugestoes.push({
        simboloId: configuracao.tipoAudio,
        quantidade: 1,
        ambiente: ambiente.nome,
        posX: ambiente.posX,
        posY: ambiente.posY,
        limites: ambiente.limites,
        ancoras: ambiente.ancoras,
      });
    }

    if (questionario.servicos.includes("rede") && configuracao.pontosRede > 0) {
      sugestoes.push({
        simboloId: "ponto-de-rede",
        quantidade: configuracao.pontosRede,
        ambiente: ambiente.nome,
        posX: ambiente.posX,
        posY: ambiente.posY,
        limites: ambiente.limites,
        ancoras: ambiente.ancoras,
        observacao: ehEscritorio(ambiente)
          ? "1 ponto para cada computador + 1 ponto para possivel impressora"
          : undefined,
      });
    }
  }

  const agruparLocais = (
    locais: QuestionarioProjeto["unifiAps"]
  ): Map<string, { ambienteNome: string; posX?: number; posY?: number; quantidade: number }> => {
    const quantidades = new Map<string, { ambienteNome: string; posX?: number; posY?: number; quantidade: number }>();
    for (const local of locais ?? []) {
      if (local.plantaId !== undefined && local.plantaId !== plantaId) continue;
      const chave = `${local.plantaId ?? "legacy"}::${local.ambienteNome}::${Math.round(local.posX ?? 0)}::${Math.round(local.posY ?? 0)}`;
      const atual = quantidades.get(chave);
      quantidades.set(chave, {
        ambienteNome: local.ambienteNome,
        posX: local.posX,
        posY: local.posY,
        quantidade: (atual?.quantidade ?? 0) + 1,
      });
    }
    return quantidades;
  };

  for (const { ambienteNome, posX, posY, quantidade } of questionario.servicos.includes("rede")
    ? agruparLocais(questionario.unifiAps).values()
    : []) {
    const ambiente = encontrarAmbienteConfigurado(ambientes, ambienteNome, posX, posY);
    if (!ambiente) continue;
    sugestoes.push({
      simboloId: "unifi-ap",
      quantidade,
      ambiente: ambiente.nome,
      posX: ambiente.posX,
      posY: ambiente.posY,
      limites: ambiente.limites,
      ancoras: ambiente.ancoras,
    });
  }

  for (const { ambienteNome, posX, posY, quantidade } of questionario.servicos.includes("automacao")
    ? agruparLocais(questionario.quadrosAutomacao).values()
    : []) {
    const ambiente = encontrarAmbienteConfigurado(ambientes, ambienteNome, posX, posY);
    if (!ambiente) continue;
    sugestoes.push({
      simboloId: "quadro-automacao",
      quantidade,
      ambiente: ambiente.nome,
      posX: ambiente.posX,
      posY: ambiente.posY,
      limites: ambiente.limites,
      ancoras: ambiente.ancoras,
    });
  }

  return sugestoes;
}

function distanciaEntrePontos(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroDaRegiao(regiao: LimitesPlanta): { x: number; y: number } {
  return {
    x: (regiao.minX + regiao.maxX) / 2,
    y: (regiao.minY + regiao.maxY) / 2,
  };
}

function escolherPosicoesDosAps(
  ambientes: AmbienteDetectado[],
  quantidade: number,
  regiao?: LimitesPlanta
): { x: number; y: number }[] {
  const circulacoes = escolherAmbientesDeCirculacaoParaAp(ambientes);
  const grupoPrincipal = agruparAmbientes(ambientes)[0] ?? ambientes;
  const centro = grupoPrincipal.length > 0 ? centroDosAmbientes(grupoPrincipal) : undefined;
  const base = circulacoes[0]
    ? centroDoAmbienteParaAp(circulacoes[0], ambientes)
    : regiao
      ? centroDaRegiao(regiao)
      : centro
        ? { x: centro.posX, y: centro.posY }
        : { x: 0, y: 0 };
  const pontos: { x: number; y: number }[] = [];

  for (const circulacao of circulacoes) {
    if (pontos.length >= quantidade) break;
    const centroCirculacao = centroDoAmbienteParaAp(circulacao, ambientes);
    const ponto = limitarNaRegiao(centroCirculacao, regiao);
    if (pontos.every((existente) => distanciaEntrePontos(existente, ponto) >= 36)) pontos.push(ponto);
  }

  const offsets = [
    { x: 0, y: 0 },
    { x: 72, y: 0 },
    { x: -72, y: 0 },
    { x: 0, y: 72 },
    { x: 0, y: -72 },
  ];
  for (const offset of offsets) {
    if (pontos.length >= quantidade) break;
    const ponto = limitarNaRegiao({ x: base.x + offset.x, y: base.y + offset.y }, regiao);
    if (pontos.every((existente) => distanciaEntrePontos(existente, ponto) >= 36)) pontos.push(ponto);
  }

  return pontos.slice(0, quantidade);
}

function limitarNaRegiao(posicao: { x: number; y: number }, regiao?: LimitesPlanta): { x: number; y: number } {
  if (!regiao) return posicao;
  const margem = Math.min(24, (regiao.maxX - regiao.minX) / 4, (regiao.maxY - regiao.minY) / 4);
  return {
    x: Math.min(regiao.maxX - margem, Math.max(regiao.minX + margem, posicao.x)),
    y: Math.min(regiao.maxY - margem, Math.max(regiao.minY + margem, posicao.y)),
  };
}

function pontoDentroDaRegiao(posicao: { x: number; y: number }, regiao?: LimitesPlanta): boolean {
  if (!regiao) return true;
  const margem = Math.min(24, (regiao.maxX - regiao.minX) / 4, (regiao.maxY - regiao.minY) / 4);
  return (
    posicao.x >= regiao.minX + margem &&
    posicao.x <= regiao.maxX - margem &&
    posicao.y >= regiao.minY + margem &&
    posicao.y <= regiao.maxY - margem
  );
}

/**
 * Aproxima a area do comodo usando os rotulos vizinhos. Nao substitui uma
 * leitura CAD das paredes, mas cria uma zona local muito melhor que usar o
 * retangulo da pagina inteira quando a planta tem varios ambientes.
 */
function calcularZonaDoAmbiente(
  ambiente: AmbienteDetectado,
  ambientes: AmbienteDetectado[],
  regiao?: LimitesPlanta,
  semMargemInicial = false
): LimitesPlanta | undefined {
  if (!regiao) return undefined;

  const margem = semMargemInicial
    ? 0
    : Math.min(24, (regiao.maxX - regiao.minX) / 4, (regiao.maxY - regiao.minY) / 4);
  let minX = regiao.minX + margem;
  let minY = regiao.minY + margem;
  let maxX = regiao.maxX - margem;
  let maxY = regiao.maxY - margem;
  const vizinhos = ambientes.filter(
    (item) => item !== ambiente && (!ambiente.limites || item.limites === ambiente.limites)
  );

  for (const vizinho of vizinhos) {
    const deltaX = vizinho.posX - ambiente.posX;
    const deltaY = vizinho.posY - ambiente.posY;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      if (deltaX < 0) minX = Math.max(minX, (ambiente.posX + vizinho.posX) / 2);
      else maxX = Math.min(maxX, (ambiente.posX + vizinho.posX) / 2);
    } else if (deltaY < 0) {
      minY = Math.max(minY, (ambiente.posY + vizinho.posY) / 2);
    } else {
      maxY = Math.min(maxY, (ambiente.posY + vizinho.posY) / 2);
    }
  }

  // Quando a leitura rasterizada une toda a arquitetura em uma unica regiao,
  // os limites da pagina podem ficar grandes demais para um unico comodo.
  // Mantemos a zona centrada no rotulo e limitada a um bloco local para que
  // pontos de rede nao sejam enviados para outra area da prancha.
  const limitarIntervalo = (minimo: number, maximo: number, centro: number, tamanhoMaximo: number) => {
    if (maximo - minimo <= tamanhoMaximo) return { minimo, maximo };
    let inicio = Math.max(minimo, centro - tamanhoMaximo / 2);
    let fim = Math.min(maximo, centro + tamanhoMaximo / 2);
    if (fim - inicio < tamanhoMaximo) {
      if (inicio === minimo) fim = Math.min(maximo, inicio + tamanhoMaximo);
      else inicio = Math.max(minimo, fim - tamanhoMaximo);
    }
    return { minimo: inicio, maximo: fim };
  };
  const intervaloX = limitarIntervalo(minX, maxX, ambiente.posX, 480);
  const intervaloY = limitarIntervalo(minY, maxY, ambiente.posY, 240);
  minX = intervaloX.minimo;
  maxX = intervaloX.maximo;
  minY = intervaloY.minimo;
  maxY = intervaloY.maximo;

  // Mesmo uma regiao local pode conter a borda da folha ou um carimbo. Nao
  // permitimos que uma parede estimada fique muito distante do proprio rotulo
  // quando o detector nao conseguiu separar as paredes internas.
  minX = Math.max(minX, ambiente.posX - 180);
  maxX = Math.min(maxX, ambiente.posX + 180);
  minY = Math.max(minY, ambiente.posY - 120);
  maxY = Math.min(maxY, ambiente.posY + 120);

  if (maxX - minX >= 72 && maxY - minY >= 72) return { minX, minY, maxX, maxY };

  // Se os rótulos vizinhos produziram uma interseção estreita ou inválida,
  // nunca devolvemos a região inteira da prancha. Um retângulo local centrado
  // no rótulo mantém áudio e rede dentro do cômodo mais provável.
  return {
    minX: ambiente.posX - 120,
    minY: ambiente.posY - 80,
    maxX: ambiente.posX + 120,
    maxY: ambiente.posY + 80,
  };
}

function distanciaDaBorda(posicao: { x: number; y: number }, regiao?: LimitesPlanta): number {
  if (!regiao) return Infinity;
  return Math.min(
    posicao.x - regiao.minX,
    regiao.maxX - posicao.x,
    posicao.y - regiao.minY,
    regiao.maxY - posicao.y
  );
}

function ehQuarto(ambiente?: AmbienteDetectado): boolean {
  if (!ambiente) return false;
  const nome = normalizar(ambiente.nome);
  return (/quarto|dormitorio|suite/.test(nome)) && !/closet|banho|banheiro/.test(nome);
}

function ehVaranda(ambiente?: AmbienteDetectado): boolean {
  if (!ambiente) return false;
  return /varanda|sacada|terraco|jardim/.test(normalizar(ambiente.nome));
}


function ancorasDeRede(ambiente?: AmbienteDetectado): AncoraAmbiente[] {
  return [...(ambiente?.ancoras ?? [])]
    .filter((ancora) => /\btv\b|televis|painel|rack|estante|prateleira|mesa|criado|bancada|escrivaninha|computador|desktop|notebook|laptop|\bpc\b|impressora/i.test(ancora.texto))
    .sort((a, b) => b.prioridade - a.prioridade);
}

function posicoesFallbackDosPesDaCama(
  regiao: LimitesPlanta | undefined,
  quantidade: number,
  centroPreferencialX?: number
): { x: number; y: number }[] {
  if (!regiao) return [];
  const margem = Math.min(24, (regiao.maxX - regiao.minX) / 4, (regiao.maxY - regiao.minY) / 4);
  const minX = regiao.minX + margem;
  const maxX = regiao.maxX - margem;
  const minY = regiao.minY + margem;
  const maxY = regiao.maxY - margem;
  const largura = maxX - minX;
  const altura = maxY - minY;
  if (largura >= altura) {
    const centro = centroPreferencialX === undefined
      ? (minX + maxX) / 2
      : Math.min(maxX, Math.max(minX, centroPreferencialX));
    const colunas = quantidade === 2
      ? [
          Math.max(minX, centro - largura / 6),
          Math.min(maxX, centro + largura / 6),
        ]
      : colunasDoQuarto(minX, largura, quantidade);
    return colunas.map((x) => ({
      x,
      y: maxY,
    }));
  }
  if (quantidade === 2) {
    return [
      { x: maxX, y: minY + altura / 3 },
      { x: maxX, y: minY + (altura * 2) / 3 },
    ];
  }
  return Array.from({ length: quantidade }, (_, indice) => ({
    x: maxX,
    y: minY + altura * ((indice + 1) / (quantidade + 1)),
  }));
}

function colunasDoQuarto(minX: number, largura: number, quantidade: number): number[] {
  return Array.from({ length: quantidade }, (_, indice) => minX + largura * ((indice + 1) / (quantidade + 1)));
}

/**
 * Sem uma ancora textual (mesa, rack, estante etc.), a rede ainda precisa ser
 * sugerida. Nesse caso usamos a parede interna mais longa da zona estimada,
 * distribuindo os pontos de forma simetrica. E uma posicao revisavel, mas nao
 * deixa o item flutuando no meio do comodo nem some com a quantidade pedida.
 */
function posicoesFallbackDeRede(regiao: LimitesPlanta | undefined, quantidade: number): { x: number; y: number }[] {
  if (!regiao || quantidade <= 0) return [];
  // O centro do marcador deve coincidir com a parede. A âncora do símbolo é
  // centralizada pelo CSS, então não usamos margem interna neste fallback.
  const margem = 0;
  const minX = regiao.minX + margem;
  const maxX = regiao.maxX - margem;
  const minY = regiao.minY + margem;
  const maxY = regiao.maxY - margem;
  const largura = maxX - minX;
  const altura = maxY - minY;
  // A região detectada vem do agrupamento em células de 36 px e costuma
  // terminar alguns pixels antes da linha arquitetônica. Projetamos o centro
  // do marcador até essa linha, mantendo o agrupamento curto dos pontos.
  const deslocamentoAteParede = Math.min(24, Math.max(0, Math.min(largura, altura) / 8));

  if (largura >= altura) {
    const centro = (minX + maxX) / 2;
    const separacao = 14;
    return Array.from({ length: quantidade }, (_, indice) => ({
      x: centro + (indice - (quantidade - 1) / 2) * separacao,
      y: minY - deslocamentoAteParede,
    }));
  }
  const centro = (minY + maxY) / 2;
  const separacao = 14;
  return Array.from({ length: quantidade }, (_, indice) => ({
    x: minX - deslocamentoAteParede,
    y: centro + (indice - (quantidade - 1) / 2) * separacao,
  }));
}

function posicoesSimetricasDeAudio(
  regiao: LimitesPlanta | undefined,
  quantidade: number,
  vertical = false
): { x: number; y: number }[] {
  if (!regiao || quantidade !== 2) return [];
  const margem = Math.min(24, (regiao.maxX - regiao.minX) / 4, (regiao.maxY - regiao.minY) / 4);
  const minX = regiao.minX + margem;
  const maxX = regiao.maxX - margem;
  const minY = regiao.minY + margem;
  const maxY = regiao.maxY - margem;
  const largura = maxX - minX;
  const altura = maxY - minY;

  if (!vertical && largura >= altura) {
    const y = (minY + maxY) / 2;
    return [
      { x: minX + largura / 3, y },
      { x: minX + (largura * 2) / 3, y },
    ];
  }
  const x = (minX + maxX) / 2;
  return [
    { x, y: minY + altura / 3 },
    { x, y: minY + (altura * 2) / 3 },
  ];
}




/**
 * Prioriza as posicoes da referencia calibrada para o PDF. Sem referencia,
 * usa as ancoras disponiveis; a rede sem apoio identificado fica pendente.
 * Os demais equipamentos ainda usam a distribuicao estimada do ambiente.
 */
export function calcularPosicoesDaSugestao(
  sugestao: SugestaoPonto,
  ambientes: AmbienteDetectado[]
): { x: number; y: number }[] {
  const ambiente = ambientes
    .filter((item) => item.nome === sugestao.ambiente)
    .sort((a, b) => Math.hypot(a.posX - sugestao.posX, a.posY - sugestao.posY) - Math.hypot(b.posX - sugestao.posX, b.posY - sugestao.posY))[0];
  if (sugestao.quantidade <= 0) return [];
  const pontosReferencia = sugestao.simboloId === "ponto-de-rede"
    ? ambiente?.referencia?.rede
    : sugestao.simboloId === "caixa-embutir" || sugestao.simboloId === "caixa-embutir-bluetooth"
      ? ambiente?.referencia?.caixas
      : undefined;
  if (pontosReferencia && pontosReferencia.length > 0) {
    return pontosReferencia.slice(0, sugestao.quantidade).map((ponto) => ({ ...ponto }));
  }
  const regiao = sugestao.limites ?? ambiente?.limites;
  if (sugestao.simboloId === "unifi-ap" && ambiente) {
    const zona = calcularZonaDoAmbiente(ambiente, ambientes, regiao) ?? regiao;
    const centro = centroDoAmbienteParaAp(ambiente, ambientes);
    const offsets = [
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: -48, y: 0 },
      { x: 0, y: 48 },
      { x: 0, y: -48 },
    ];
    return offsets
      .slice(0, sugestao.quantidade)
      .map((offset) => limitarNaRegiao({ x: centro.x + offset.x, y: centro.y + offset.y }, zona));
  }
  if (sugestao.simboloId === "unifi-ap" && sugestao.ambiente === "cobertura do andar" && !ambiente) {
    return escolherPosicoesDosAps(ambientes, sugestao.quantidade, regiao);
  }
  const rede = sugestao.simboloId === "ponto-de-rede";
  const zonaDoAmbiente = ambiente
    ? calcularZonaDoAmbiente(ambiente, ambientes, regiao, rede)
    : regiao;
  const eSugestaoDoAndar = !ambiente;
  const ancorasRede = rede ? ancorasDeRede(ambiente) : [];
  const ancoraDeUso = ancorasRede[0];

  if (ehQuarto(ambiente) && (sugestao.simboloId === "caixa-embutir" || sugestao.simboloId === "caixa-embutir-bluetooth")) {
    // Um unico texto de cama detectado de forma parcial nao e evidencia
    // suficiente para escolher um lado do quarto. A distribuicao geometrica
    // garante que as caixas dos quartos permaneçam simetricas.
    const fallback = posicoesFallbackDosPesDaCama(zonaDoAmbiente, sugestao.quantidade, ambiente?.posX);
    if (fallback.length >= sugestao.quantidade) return fallback.slice(0, sugestao.quantidade);
    const fallbackSemRegiao = Array.from({ length: sugestao.quantidade }, (_, indice) => ({
      x: sugestao.posX + (indice % 2 === 0 ? -36 : 36),
      y: sugestao.posY + 72 + Math.floor(indice / 2) * 24,
    }));
    return fallbackSemRegiao.slice(0, sugestao.quantidade);
  }

  if (
    sugestao.simboloId === "caixa-embutir" ||
    sugestao.simboloId === "caixa-embutir-bluetooth"
  ) {
    const pontosSimetricos = posicoesSimetricasDeAudio(
      zonaDoAmbiente ?? regiao,
      sugestao.quantidade,
      ehVaranda(ambiente)
    );
    if (pontosSimetricos.length === sugestao.quantidade) return pontosSimetricos;
  }

  if (rede && ancorasRede.length > 0) {
    const pontos = ancorasRede
      .slice(0, sugestao.quantidade)
      .map((ancora) => limitarNaRegiao({ x: ancora.posX, y: ancora.posY }, zonaDoAmbiente));
    const ancoraPrincipal = ancorasRede[0];
    const offsetsDaAncora = [
      { x: -18, y: 0 },
      { x: 18, y: 0 },
      { x: 0, y: -18 },
      { x: 0, y: 18 },
    ];
    for (const offset of offsetsDaAncora) {
      if (pontos.length >= sugestao.quantidade) break;
      const candidato = limitarNaRegiao(
        { x: ancoraPrincipal.posX + offset.x, y: ancoraPrincipal.posY + offset.y },
        zonaDoAmbiente
      );
      if (pontos.every((existente) => distanciaEntrePontos(existente, candidato) >= 24)) pontos.push(candidato);
    }
    return pontos.slice(0, sugestao.quantidade);
  }

  if (rede) {
    return posicoesFallbackDeRede(zonaDoAmbiente ?? regiao, sugestao.quantidade);
  }
  const ancora = ancoraDeUso
    ? { x: ancoraDeUso.posX, y: ancoraDeUso.posY }
    : eSugestaoDoAndar && regiao
      ? centroDaRegiao(regiao)
      : { x: sugestao.posX, y: sugestao.posY };

  const offsets = ancoraDeUso
    ? [
        { x: 0, y: 0 },
        { x: -18, y: 0 },
        { x: 18, y: 0 },
        { x: 0, y: -18 },
        { x: 0, y: 18 },
        { x: -16, y: -12 },
        { x: 16, y: -12 },
        { x: -16, y: 12 },
        { x: 16, y: 12 },
      ]
    : [
        { x: -46, y: 0 },
        { x: 46, y: 0 },
        { x: 0, y: -46 },
        { x: 0, y: 46 },
        { x: -34, y: -34 },
        { x: 34, y: -34 },
        { x: -34, y: 34 },
        { x: 34, y: 34 },
        { x: -64, y: 0 },
        { x: 64, y: 0 },
      ];
  const vizinhos = ambiente
    ? ambientes
        .filter((item) => item !== ambiente)
        .sort((a, b) => Math.hypot(a.posX - ancora.x, a.posY - ancora.y) - Math.hypot(b.posX - ancora.x, b.posY - ancora.y))
        .slice(0, 4)
    : [];

  const candidatos = offsets
    .map((offset) => limitarNaRegiao({ x: ancora.x + offset.x, y: ancora.y + offset.y }, zonaDoAmbiente))
    .filter((posicao, indice, lista) => pontoDentroDaRegiao(posicao, zonaDoAmbiente) && lista.findIndex((item) => distanciaEntrePontos(item, posicao) < 1) === indice)
    .map((posicao) => {
      const menorDistanciaVizinho = vizinhos.length > 0
        ? Math.min(...vizinhos.map((vizinho) => Math.hypot(vizinho.posX - posicao.x, vizinho.posY - posicao.y)))
        : 0;
      const procurarParede = rede && !ancoraDeUso;
      const preferenciaParede = procurarParede ? Math.max(0, 120 - distanciaDaBorda(posicao, zonaDoAmbiente)) : 0;
      return {
        posicao,
        pontuacao: ancoraDeUso
          ? -distanciaEntrePontos(posicao, ancora)
          : (vizinhos.length > 0 ? menorDistanciaVizinho : 0) - Math.abs(distanciaEntrePontos(posicao, ancora) - 46) * 0.25 + preferenciaParede,
      };
    })
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .map((item) => item.posicao);

  const escolhidas: { x: number; y: number }[] = [];
  for (const candidato of candidatos) {
    if (escolhidas.every((existente) => distanciaEntrePontos(existente, candidato) >= 24)) {
      escolhidas.push(candidato);
    }
    if (escolhidas.length >= sugestao.quantidade) break;
  }

  // Plantas muito pequenas podem nao comportar todos os offsets. Ainda assim,
  // devolve pontos validos e separados, sem ultrapassar a regiao encontrada.
  while (escolhidas.length < sugestao.quantidade) {
    const indice = escolhidas.length;
    const fallback = limitarNaRegiao(
      { x: ancora.x + (indice % 2 === 0 ? -12 : 12), y: ancora.y + Math.floor(indice / 2) * 12 },
      zonaDoAmbiente
    );
    escolhidas.push(fallback);
  }

  return escolhidas;
}
