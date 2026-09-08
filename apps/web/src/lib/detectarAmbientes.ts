import * as pdfjsLib from "pdfjs-dist";
import type { PlantaImportada } from "@croqui/shared";
import { urlArquivoPlanta } from "../api";
import { calcularEscalaRenderizacao } from "./pdfRender";

/** Um ambiente (comodo) detectado a partir do texto do PDF da planta. */
export interface AmbienteDetectado {
  nome: string;
  areaM2: number | null;
  /** Posicao no mesmo espaco de pixel do canvas (igual a pos_x/pos_y dos pontos). */
  posX: number;
  posY: number;
}

// Bate com "A:14.31m²", "A: 14,31 M2", "A 14.31m²" etc - o padrao usado nos
// rotulos de ambiente dos croquis de referencia.
const REGEX_AREA = /^A[:.]?\s*([\d]+[.,]\d+)\s*m[²2]$/i;

// Rotulos que aparecem perto dos ambientes mas nao sao nomes de comodo -
// filtra pra nao "adotar" cotas/textos genericos como se fossem sala.
const IGNORAR = /^(esc\.?:|planta|pav\.?|folha|escala|nota|rev\.?)/i;

// Exige uma sequencia de pelo menos 3 letras seguidas. Plantas reais tem
// MUITO mais texto do que os testes iniciais (cotas tipo "3,20", "1x0,90",
// codigo de porta "P22", diametros "Ø50") - sem esse filtro, o texto mais
// PROXIMO de um rotulo de area podia ser uma cota em vez do nome do
// ambiente. Nomes de ambiente nos croquis de referencia sao sempre palavras
// (SUÍTE, BANHEIRO, CLOSET...), entao exigir letras elimina as cotas.
const PARECE_PALAVRA = /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/;

const DISTANCIA_MAX_PX = 45; // no mesmo espaco de pixel do canvas (ver calcularEscalaRenderizacao)

interface ItemTexto {
  texto: string;
  x: number;
  y: number;
}

function pareceNomeDeAmbiente(texto: string): boolean {
  if (texto.length < 3) return false;
  if (REGEX_AREA.test(texto)) return false;
  if (IGNORAR.test(texto)) return false;
  return PARECE_PALAVRA.test(texto);
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

  const indice = construirIndiceEspacial(itens, DISTANCIA_MAX_PX);
  const ambientes: AmbienteDetectado[] = [];

  for (const candidatoArea of itens) {
    const match = candidatoArea.texto.match(REGEX_AREA);
    if (!match) continue;

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
        areaM2: parseFloat(match[1].replace(",", ".")),
        posX: (melhorNome.x + candidatoArea.x) / 2,
        posY: (melhorNome.y + candidatoArea.y) / 2,
      });
    }
  }

  return ambientes;
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
