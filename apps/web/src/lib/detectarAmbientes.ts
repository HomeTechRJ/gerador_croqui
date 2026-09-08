import * as pdfjsLib from "pdfjs-dist";
import type { PlantaImportada } from "@croqui/shared";
import { urlArquivoPlanta } from "../api";

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

const DISTANCIA_MAX_PX = 45; // a escala 2x do viewport (ver renderizarPaginaCroqui)

interface ItemTexto {
  texto: string;
  x: number;
  y: number;
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
  const viewport = pagina.getViewport({ scale: 2 });
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

  const ambientes: AmbienteDetectado[] = [];
  for (const candidatoArea of itens) {
    const match = candidatoArea.texto.match(REGEX_AREA);
    if (!match) continue;

    let melhorNome: ItemTexto | null = null;
    let melhorDist = Infinity;
    for (const candidatoNome of itens) {
      if (candidatoNome === candidatoArea) continue;
      if (REGEX_AREA.test(candidatoNome.texto)) continue;
      if (IGNORAR.test(candidatoNome.texto)) continue;
      if (candidatoNome.texto.length < 2) continue;

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
