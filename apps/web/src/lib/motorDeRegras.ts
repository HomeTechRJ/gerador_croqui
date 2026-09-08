import type { ServiceCategory } from "@croqui/shared";
import type { AmbienteDetectado } from "./detectarAmbientes";

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

interface RegraAmbiente {
  nome: string;
  categoriaNecessaria: ServiceCategory;
  testar: (nomeNormalizado: string) => boolean;
  gerar: () => ItemGerado[];
}

// Regras por tipo de ambiente. A ordem nao importa - todas as que baterem se
// acumulam (ex: sala pode levar rede E multiroom, sao regras diferentes).
const REGRAS_AMBIENTE: RegraAmbiente[] = [
  {
    nome: "Suite master - audio",
    categoriaNecessaria: "audio",
    testar: (n) => /suite.*master|master.*suite/.test(n),
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
    for (const item of regra.gerar()) {
      sugestoes.push({ ...item, ambiente: ambiente.nome, posX: ambiente.posX, posY: ambiente.posY });
    }
  }

  return sugestoes;
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
  const posReferencia = ambientes[Math.floor(ambientes.length / 2)];

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
      observacao: `~${Math.round(areaTotal)}m² detectados no andar - confirmar posição de melhor cobertura`,
      revisar: true,
    });
  }

  if (servicos.includes("automacao")) {
    sugestoes.push({
      simboloId: "quadro-automacao",
      quantidade: 1,
      ambiente: "próximo ao quadro elétrico",
      posX: ambientes[0].posX,
      posY: ambientes[0].posY,
      observacao: "posicionar perto do quadro elétrico do andar",
      revisar: true,
    });
  }

  return sugestoes;
}
