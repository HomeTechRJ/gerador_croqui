import * as pdfjsLib from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import type Tesseract from "tesseract.js";
import type { PlantaImportada } from "@croqui/shared";
import { urlArquivoPlanta } from "../api";
import { calcularEscalaRenderizacao } from "./pdfRender";
import { aplicarReferenciasDaPlanta } from "./referenciasPlanta";
import type { ReferenciaAmbiente } from "./referenciasPlanta";

/** Um ambiente (comodo) detectado a partir do texto do PDF da planta. */
export interface AmbienteDetectado {
  nome: string;
  areaM2: number | null;
  /** Posicao no mesmo espaco de pixel do canvas (igual a pos_x/pos_y dos pontos). */
  posX: number;
  posY: number;
  /** Regiao do desenho arquitetonico onde o ambiente foi encontrado. */
  limites?: LimitesPlanta;
  /** Textos de mobiliario/equipamento que ajudam a posicionar os pontos. */
  ancoras?: AncoraAmbiente[];
  /** Posicoes calibradas pelo usuario para o conteudo exato deste PDF. */
  referencia?: ReferenciaAmbiente;
  /** Evidencia textual encontrada perto do ambiente; pode ser desconhecida em PDF rasterizado. */
  temComputadores?: boolean;
}

export interface LimitesPlanta {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AncoraAmbiente {
  texto: string;
  posX: number;
  posY: number;
  prioridade: number;
}

// Bate com "A:14.31m²", "A: 14,31 M2" e tambem com "11,76 m²".
// Algumas plantas trazem a metragem antes do nome do ambiente e outras usam
// o prefixo "A:"; as duas formas precisam alimentar o mesmo detector.
// Rotulos que aparecem perto dos ambientes mas nao sao nomes de comodo -
// filtra pra nao "adotar" cotas/textos genericos como se fossem sala.
const IGNORAR = /^(esc\.?:|planta|pav\.?|folha|escala|nota|rev\.?)/i;

// Aceita tambem as variantes m2/m²/mÂ² que aparecem em PDFs rasterizados.
const REGEX_AREA_FLEXIVEL = /^(?:A[:.]?\s*)?([\d]+[.,]\d+)\s*m\s*(?:\u00c2?\u00b2|2)$/i;

// Exige uma sequencia de pelo menos 3 letras seguidas. Plantas reais tem
// MUITO mais texto do que os testes iniciais (cotas tipo "3,20", "1x0,90",
// codigo de porta "P22", diametros "Ø50") - sem esse filtro, o texto mais
// PROXIMO de um rotulo de area podia ser uma cota em vez do nome do
// ambiente. Nomes de ambiente nos croquis de referencia sao sempre palavras
// (SUÍTE, BANHEIRO, CLOSET...), entao exigir letras elimina as cotas.
const PARECE_PALAVRA = /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/;

// Quando o PDF nao traz metragem, usamos um segundo filtro conservador: o
// texto precisa conter um nome de ambiente conhecido. Isso evita transformar
// "poltrona", cotas, notas e nomes de equipamentos em comodos detectados.
const TERMOS_DE_AMBIENTE =
  /(^| )(quarto|dormitorio|suite|banh|lavabo|closet|sala|estar|living|home|theater|cinema|gourmet|cozinha|copa|despensa|escritorio|brinquedoteca|hall|lavanderia|servico|sauna|varanda|sacada|terraco|jardim|piscina|academia|adega|deposito|rouparia|circulacao|corredor|entrada|foyer|atelie|biblioteca|sotao|porao|garagem|area (gourmet|externa|desc|descoberta|tecnica))($| )/i;
const TERMOS_DE_EQUIPAMENTO =
  /caixa|unifi|ponto de rede|multiroom|subwoofer|receiver|automa[cç][aã]o|embutir|bluetooth|outdoor|bookshelf/i;

const TERMOS_DE_COMPUTADOR = /computador(?:es)?|desktop|notebook|laptop|\bpc\b/i;
const TERMOS_DE_AMBIENTE_ADICIONAIS =
  /(^| )(menina|meninas|menino|meninos|casal|hospede|master|kids|infantil|jovem)($| )/i;

const TERMOS_DE_ANCRA =
  /\btv\b|televis[aã]o|painel|rack|estante|prateleira|mesa(?: de (?:cabeceira|trabalho))?|criado[- ]mudo|bancada|escrivaninha|cama(?:\s+\w+)?|computador(?:es)?|desktop|notebook|laptop|\bpc\b|impressora/i;
const DISTANCIA_MAX_PX = 45; // no mesmo espaco de pixel do canvas (ver calcularEscalaRenderizacao)

interface ItemTexto {
  texto: string;
  x: number;
  y: number;
}

const TAMANHO_CELULA_REGIAO = 36;

function distanciaARegiao(x: number, y: number, regiao: LimitesPlanta): number {
  const dx = Math.max(regiao.minX - x, 0, x - regiao.maxX);
  const dy = Math.max(regiao.minY - y, 0, y - regiao.maxY);
  return Math.hypot(dx, dy);
}

function areaDaRegiao(regiao: LimitesPlanta): number {
  return Math.max(0, regiao.maxX - regiao.minX) * Math.max(0, regiao.maxY - regiao.minY);
}

function pixelTemTinta(data: Uint8ClampedArray, indice: number): boolean {
  const alpha = data[indice + 3];
  if (alpha < 20) return false;
  return data[indice] < 245 || data[indice + 1] < 245 || data[indice + 2] < 245;
}

/**
 * Encontra os blocos grandes de desenho da pagina. Textos da legenda, titulo e
 * carimbo normalmente formam blocos pequenos; paredes, cotas e mobiliario da
 * planta formam uma regiao maior. Isso cria uma barreira para a sugestao nao
 * cair na legenda ou fora do desenho arquitetonico.
 */
async function detectarRegioesDaPlanta(
  pagina: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>
): Promise<LimitesPlanta[]> {
  if (typeof document === "undefined") return [];

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) return [];

  try {
    await pagina.render({ canvasContext: contexto, viewport }).promise;
    const imagem = contexto.getImageData(0, 0, canvas.width, canvas.height);
    const colunas = Math.ceil(canvas.width / TAMANHO_CELULA_REGIAO);
    const linhas = Math.ceil(canvas.height / TAMANHO_CELULA_REGIAO);
    const ocupada = Array.from({ length: linhas }, () => Array<boolean>(colunas).fill(false));

    for (let linha = 0; linha < linhas; linha++) {
      const inicioY = linha * TAMANHO_CELULA_REGIAO;
      const fimY = Math.min(canvas.height, inicioY + TAMANHO_CELULA_REGIAO);
      for (let coluna = 0; coluna < colunas; coluna++) {
        const inicioX = coluna * TAMANHO_CELULA_REGIAO;
        const fimX = Math.min(canvas.width, inicioX + TAMANHO_CELULA_REGIAO);
        let tinta = 0;
        let amostras = 0;

        for (let y = inicioY; y < fimY; y += 3) {
          for (let x = inicioX; x < fimX; x += 3) {
            amostras++;
            if (pixelTemTinta(imagem.data, (y * canvas.width + x) * 4)) tinta++;
          }
        }

        // Uma linha arquitetonica atravessando a celula ja e suficiente para
        // mante-la no componente; a conexao entre celulas elimina o ruido de
        // textos isolados.
        ocupada[linha][coluna] = tinta >= Math.max(2, Math.floor(amostras * 0.01));
      }
    }

    // Fecha pequenos intervalos entre paredes e textos do mesmo desenho.
    const expandida = Array.from({ length: linhas }, () => Array<boolean>(colunas).fill(false));
    for (let linha = 0; linha < linhas; linha++) {
      for (let coluna = 0; coluna < colunas; coluna++) {
        if (!ocupada[linha][coluna]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const y = linha + dy;
            const x = coluna + dx;
            if (y >= 0 && y < linhas && x >= 0 && x < colunas) expandida[y][x] = true;
          }
        }
      }
    }

    const visitada = Array.from({ length: linhas }, () => Array<boolean>(colunas).fill(false));
    const regioes: LimitesPlanta[] = [];
    for (let linha = 0; linha < linhas; linha++) {
      for (let coluna = 0; coluna < colunas; coluna++) {
        if (!expandida[linha][coluna] || visitada[linha][coluna]) continue;
        const fila = [{ linha, coluna }];
        visitada[linha][coluna] = true;
        let quantidade = 0;
        let minColuna = coluna;
        let maxColuna = coluna;
        let minLinha = linha;
        let maxLinha = linha;

        while (fila.length > 0) {
          const atual = fila.shift();
          if (!atual) continue;
          quantidade++;
          minColuna = Math.min(minColuna, atual.coluna);
          maxColuna = Math.max(maxColuna, atual.coluna);
          minLinha = Math.min(minLinha, atual.linha);
          maxLinha = Math.max(maxLinha, atual.linha);

          for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const proximaLinha = atual.linha + dy;
            const proximaColuna = atual.coluna + dx;
            if (
              proximaLinha >= 0 &&
              proximaLinha < linhas &&
              proximaColuna >= 0 &&
              proximaColuna < colunas &&
              expandida[proximaLinha][proximaColuna] &&
              !visitada[proximaLinha][proximaColuna]
            ) {
              visitada[proximaLinha][proximaColuna] = true;
              fila.push({ linha: proximaLinha, coluna: proximaColuna });
            }
          }
        }

        const regiao = {
          minX: minColuna * TAMANHO_CELULA_REGIAO,
          minY: minLinha * TAMANHO_CELULA_REGIAO,
          maxX: Math.min(canvas.width, (maxColuna + 1) * TAMANHO_CELULA_REGIAO),
          maxY: Math.min(canvas.height, (maxLinha + 1) * TAMANHO_CELULA_REGIAO),
        };
        if (quantidade >= 8 && regiao.maxX - regiao.minX >= 120 && regiao.maxY - regiao.minY >= 80) {
          regioes.push(regiao);
        }
      }
    }

    return regioes.sort((a, b) => areaDaRegiao(b) - areaDaRegiao(a));
  } catch {
    return [];
  }
}

function escolherLimitesDaPlanta(
  regioes: LimitesPlanta[],
  posX: number,
  posY: number
): LimitesPlanta | undefined {
  if (regioes.length === 0) return undefined;

  // Ignora blocos muito menores que a maior planta, como legendas e carimbos.
  const maiorArea = areaDaRegiao(regioes[0]);
  const candidatas = regioes.filter((regiao) => areaDaRegiao(regiao) >= maiorArea * 0.2);
  return [...(candidatas.length > 0 ? candidatas : regioes)].sort(
    (a, b) => distanciaARegiao(posX, posY, a) - distanciaARegiao(posX, posY, b)
  )[0];
}

function pareceNomeDeAmbiente(texto: string): boolean {
  if (texto.length < 3) return false;
  if (extrairArea(texto) !== null) return false;
  if (IGNORAR.test(texto)) return false;
  return PARECE_PALAVRA.test(texto);
}

function extrairArea(texto: string): number | null {
  const match = texto.trim().replace(/\s+/g, " ").match(REGEX_AREA_FLEXIVEL);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(",", "."));
}

function pareceNomeDeAmbienteSemArea(texto: string): boolean {
  if (!pareceNomeDeAmbiente(texto) || TERMOS_DE_EQUIPAMENTO.test(texto)) return false;
  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TERMOS_DE_AMBIENTE.test(normalizado) || TERMOS_DE_AMBIENTE_ADICIONAIS.test(normalizado);
}

function detectarComputadoresProximos(itens: ItemTexto[], posX: number, posY: number): boolean {
  return itens.some(
    (item) => TERMOS_DE_COMPUTADOR.test(item.texto) && Math.hypot(item.x - posX, item.y - posY) < 180
  );
}

function prioridadeDaAncora(texto: string): number {
  if (/\btv\b|televis[aã]o|painel|rack|estante|prateleira|mesa|criado|bancada|escrivaninha/i.test(texto)) return 4;
  if (/cama/i.test(texto)) return 3;
  if (/computador|desktop|notebook|laptop|\bpc\b|impressora/i.test(texto)) return 3;
  return 2;
}

function detectarAncorasProximas(itens: ItemTexto[], posX: number, posY: number): AncoraAmbiente[] {
  return itens
    .filter((item) => TERMOS_DE_ANCRA.test(item.texto) && Math.hypot(item.x - posX, item.y - posY) < 220)
    .map((item) => ({
      texto: item.texto,
      posX: item.x,
      posY: item.y,
      prioridade: prioridadeDaAncora(item.texto),
    }))
    .sort(
      (a, b) =>
        b.prioridade - a.prioridade ||
        Math.hypot(a.posX - posX, a.posY - posY) - Math.hypot(b.posX - posX, b.posY - posY)
    )
    .slice(0, 8);
}

/**
 * Plantas exportadas como imagem nao possuem itens no textContent do PDF.
 * Nesse caso, renderizamos a pagina na mesma escala do editor e usamos OCR
 * apenas como fallback. O resultado volta no mesmo sistema de coordenadas do
 * canvas, portanto as regras e os marcadores continuam alinhados.
 */
async function detectarItensPorOcr(
  pagina: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>
): Promise<ItemTexto[]> {
  if (typeof document === "undefined") return [];

  // Em uma prancha A1 o comodo ocupa uma parte pequena da pagina. Renderizar
  // o OCR apenas na mesma escala visual do editor deixa os nomes ilegiveis.
  // Aumentamos a escala ate um teto de memoria e depois convertemos as caixas
  // de volta para o espaco logico do canvas.
  const fatorOcr = Math.min(2.5, Math.max(1, Math.sqrt(48_000_000 / Math.max(1, viewport.width * viewport.height))));
  const viewportOcr = pagina.getViewport({ scale: viewport.scale * fatorOcr });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewportOcr.width);
  canvas.height = Math.ceil(viewportOcr.height);
  const contexto = canvas.getContext("2d");
  if (!contexto) return [];

  await pagina.render({ canvasContext: contexto, viewport: viewportOcr }).promise;

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("por+eng", 1, { logger: () => undefined });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: "11" as Tesseract.PSM });
      const resultado = await worker.recognize(canvas, {}, { text: true, blocks: true });
      const palavras = (resultado.data.blocks ?? []).flatMap((bloco) =>
        bloco.paragraphs.flatMap((paragrafo) => paragrafo.lines.flatMap((linha) => linha.words))
      );

      return palavras
        .map((palavra) => ({
          texto: palavra.text.trim(),
          x: ((palavra.bbox.x0 + palavra.bbox.x1) / 2) / fatorOcr,
          y: ((palavra.bbox.y0 + palavra.bbox.y1) / 2) / fatorOcr,
        }))
        .filter((item) => item.texto.length > 0);
    } finally {
      await worker.terminate();
    }
  } catch {
    // OCR e um recurso auxiliar: se o navegador estiver offline ou bloquear o
    // worker, a leitura textual tradicional continua sendo suficiente para
    // PDFs vetoriais.
    return [];
  }
}

/**
 * Indice espacial simples (grade de celulas) pra achar rapido os itens perto
 * de um ponto, sem comparar contra TODOS os itens da planta um a um. Plantas
 * reais de CAD costumam ter milhares de textos (cotas, hachuras, mobiliario)
 * - com N itens, comparar todos contra todos (O(n²)) fica lento demais.
 */
function construirIndiceEspacial(itens: ItemTexto[], tamanhoCelula: number) {
  const grade = new Map<string, ItemTexto[]>();
  const chave = (x: number, y: number) => `${Math.floor(x / tamanhoCelula)}:${Math.floor(y / tamanhoCelula)}`;

  for (const item of itens) {
    const k = chave(item.x, item.y);
    const lista = grade.get(k);
    if (lista) lista.push(item);
    else grade.set(k, [item]);
  }

  return {
    vizinhos(x: number, y: number): ItemTexto[] {
      const cx = Math.floor(x / tamanhoCelula);
      const cy = Math.floor(y / tamanhoCelula);
      const resultado: ItemTexto[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const lista = grade.get(`${cx + dx}:${cy + dy}`);
          if (lista) resultado.push(...lista);
        }
      }
      return resultado;
    },
  };
}

/**
 * Le o texto ja embutido no PDF (essas plantas sao vetoriais, nao imagem
 * escaneada) e casa cada rotulo de area ("A:12.30m²") com o nome do
 * ambiente mais proximo, pra descobrir sozinho os comodos da planta -
 * sem precisar de IA nem do usuario digitar nada.
 */
export async function detectarAmbientes(planta: PlantaImportada): Promise<AmbienteDetectado[]> {
  const documento = await pdfjsLib.getDocument(urlArquivoPlanta(planta.id)).promise;
  const pagina = await documento.getPage(1);
  const viewport = pagina.getViewport({ scale: calcularEscalaRenderizacao(pagina) });
  const conteudo = await pagina.getTextContent();

  const itens: ItemTexto[] = [];
  for (const item of conteudo.items) {
    if (!("str" in item) || !("transform" in item)) continue;
    const texto = item.str.trim();
    if (!texto) continue;
    const [baseX, baseY] = pdfjsLib.Util.applyTransform([0, 0], item.transform);
    const [x, y] = pdfjsLib.Util.applyTransform([baseX, baseY], viewport.transform);
    itens.push({ texto, x, y });
  }

  const temPistaDeAmbiente = itens.some(
    (item) => extrairArea(item.texto) !== null || pareceNomeDeAmbienteSemArea(item.texto)
  );
  // Alguns PDFs misturam texto vetorial (legendas e carimbo) com nomes de
  // ambientes desenhados como imagem ou convertidos em contornos. Nesse caso,
  // o PDF nao esta vazio, mas ainda assim precisamos tentar OCR.
  if (itens.length === 0 || !temPistaDeAmbiente) {
    itens.push(...(await detectarItensPorOcr(pagina, viewport)));
  }

  // A regiao e calculada independentemente do texto porque nomes de ambientes
  // podem aparecer na legenda, no carimbo ou fora do desenho principal.
  const regioesDaPlanta = await detectarRegioesDaPlanta(pagina, viewport);

  const indice = construirIndiceEspacial(itens, DISTANCIA_MAX_PX);
  const ambientes: AmbienteDetectado[] = [];
  const candidatosArea = itens
    .map((item) => ({ item, areaM2: extrairArea(item.texto) }))
    .filter((item): item is { item: ItemTexto; areaM2: number } => item.areaM2 !== null);

  for (const { item: candidatoArea, areaM2 } of candidatosArea) {

    let melhorNome: ItemTexto | null = null;
    let melhorDist = Infinity;
    for (const candidatoNome of indice.vizinhos(candidatoArea.x, candidatoArea.y)) {
      if (candidatoNome === candidatoArea) continue;
      if (!pareceNomeDeAmbiente(candidatoNome.texto)) continue;

      const dist = Math.hypot(candidatoNome.x - candidatoArea.x, candidatoNome.y - candidatoArea.y);
      if (dist < DISTANCIA_MAX_PX && dist < melhorDist) {
        melhorDist = dist;
        melhorNome = candidatoNome;
      }
    }

    if (melhorNome) {
      ambientes.push({
        nome: melhorNome.texto,
        areaM2,
        posX: (melhorNome.x + candidatoArea.x) / 2,
        posY: (melhorNome.y + candidatoArea.y) / 2,
        limites: escolherLimitesDaPlanta(
          regioesDaPlanta,
          (melhorNome.x + candidatoArea.x) / 2,
          (melhorNome.y + candidatoArea.y) / 2
        ),
        ancoras: detectarAncorasProximas(
          itens,
          (melhorNome.x + candidatoArea.x) / 2,
          (melhorNome.y + candidatoArea.y) / 2
        ),
        temComputadores: detectarComputadoresProximos(
          itens,
          (melhorNome.x + candidatoArea.x) / 2,
          (melhorNome.y + candidatoArea.y) / 2
        ),
      });
    }
  }

  // Algumas folhas misturam ambientes com metragem e ambientes sem metragem;
  // por isso este fallback roda sempre. Se o nome ja foi associado a uma area
  // proxima, nao cria um segundo ambiente no mesmo local.
  for (const item of itens) {
    if (!pareceNomeDeAmbienteSemArea(item.texto)) continue;
    const jaDetectado = ambientes.some(
      (ambiente) => ambiente.nome === item.texto && Math.hypot(ambiente.posX - item.x, ambiente.posY - item.y) < 30
    );
    if (jaDetectado) continue;
    ambientes.push({
      nome: item.texto,
      areaM2: null,
      posX: item.x,
      posY: item.y,
      limites: escolherLimitesDaPlanta(regioesDaPlanta, item.x, item.y),
      ancoras: detectarAncorasProximas(itens, item.x, item.y),
      temComputadores: detectarComputadoresProximos(itens, item.x, item.y),
    });
  }

  const dados = await documento.getData();
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(dados));
  const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return aplicarReferenciasDaPlanta(ambientes, sha256, viewport);
}

/** Ambiente detectado mais proximo de um ponto (pra auto-preencher ao plantar um simbolo). */
export function ambienteMaisProximo(
  ambientes: AmbienteDetectado[],
  posX: number,
  posY: number,
  distanciaMaxima = 220
): AmbienteDetectado | null {
  let melhor: AmbienteDetectado | null = null;
  let melhorDist = Infinity;
  for (const ambiente of ambientes) {
    const dist = Math.hypot(ambiente.posX - posX, ambiente.posY - posY);
    if (dist < distanciaMaxima && dist < melhorDist) {
      melhorDist = dist;
      melhor = ambiente;
    }
  }
  return melhor;
}
