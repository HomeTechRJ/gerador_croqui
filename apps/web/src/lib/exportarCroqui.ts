import * as pdfjsLib from "pdfjs-dist";
import type { PlantaImportada, SymbolDefinition } from "@croqui/shared";
import { urlArquivoPlanta } from "../api";
import { calcularEscalaRenderizacao } from "./pdfRender";

export interface PontoParaExportar {
  simboloId: string;
  posX: number;
  posY: number;
  rotacao: number;
}

/** Desenha um simbolo (mesma forma/cor da paleta) num ponto do canvas de exportacao. */
function desenharSimbolo(
  ctx: CanvasRenderingContext2D,
  simbolo: SymbolDefinition,
  x: number,
  y: number,
  rotacaoGraus: number,
  escala = 1
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotacaoGraus * Math.PI) / 180);
  ctx.fillStyle = simbolo.cor;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * escala;

  if (simbolo.forma === "circulo") {
    ctx.beginPath();
    ctx.arc(0, 0, 11 * escala, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (simbolo.forma === "quadrado") {
    const lado = 18 * escala;
    ctx.fillRect(-lado / 2, -lado / 2, lado, lado);
    ctx.strokeRect(-lado / 2, -lado / 2, lado, lado);
  } else {
    const largura = 28 * escala;
    const altura = 15 * escala;
    ctx.fillRect(-largura / 2, -altura / 2, largura, altura);
    ctx.strokeRect(-largura / 2, -altura / 2, largura, altura);
  }
  ctx.restore();
}

/** Legenda no canto inferior direito, so com os simbolos realmente usados nesta pagina. */
function desenharLegenda(
  ctx: CanvasRenderingContext2D,
  larguraCanvas: number,
  alturaCanvas: number,
  itens: SymbolDefinition[]
): void {
  if (itens.length === 0) return;

  const padding = 14;
  const alturaLinha = 24;
  const larguraBox = 230;
  const alturaTitulo = 26;
  const alturaBox = padding * 2 + alturaTitulo + itens.length * alturaLinha;
  const x = larguraCanvas - larguraBox - 20;
  const y = alturaCanvas - alturaBox - 20;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, larguraBox, alturaBox);
  ctx.strokeRect(x, y, larguraBox, alturaBox);

  ctx.fillStyle = "#111111";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText("LEGENDA", x + padding, y + padding + 10);

  itens.forEach((simbolo, i) => {
    const linhaY = y + padding + alturaTitulo + i * alturaLinha;
    desenharSimbolo(ctx, simbolo, x + padding + 10, linhaY - 4, 0, 0.7);
    ctx.fillStyle = "#111111";
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText(simbolo.nome, x + padding + 28, linhaY);
  });

  ctx.restore();
}

/**
 * Renderiza uma planta + os simbolos posicionados nela + a legenda dos
 * simbolos usados, tudo num canvas novo (nao o da tela) pronto pra exportar.
 */
export async function renderizarPaginaCroqui(
  planta: PlantaImportada,
  pontosDaPlanta: PontoParaExportar[],
  simbolosPorId: Map<string, SymbolDefinition>
): Promise<HTMLCanvasElement> {
  const documento = await pdfjsLib.getDocument(urlArquivoPlanta(planta.id)).promise;
  const pagina = await documento.getPage(1);
  const viewport = pagina.getViewport({ scale: calcularEscalaRenderizacao(pagina) });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível neste navegador.");

  await pagina.render({ canvasContext: ctx, viewport }).promise;

  const usados = new Map<string, SymbolDefinition>();
  for (const p of pontosDaPlanta) {
    const simbolo = simbolosPorId.get(p.simboloId);
    if (!simbolo) continue;
    desenharSimbolo(ctx, simbolo, p.posX, p.posY, p.rotacao);
    usados.set(simbolo.id, simbolo);
  }

  desenharLegenda(ctx, canvas.width, canvas.height, [...usados.values()]);

  return canvas;
}

export function baixarCanvasComoPng(canvas: HTMLCanvasElement, nomeArquivo: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/**
 * Uma pagina por canvas, na ordem dada. O jsPDF (e as libs pesadas que ele
 * carrega - html2canvas, dompurify) so entram no bundle quando essa funcao e
 * chamada de verdade (import dinamico), pra nao pesar o carregamento inicial
 * do app com algo usado so na exportacao.
 */
export async function baixarCanvasesComoPdf(canvases: HTMLCanvasElement[], nomeArquivo: string): Promise<void> {
  if (canvases.length === 0) return;

  const { jsPDF } = await import("jspdf");

  let doc: InstanceType<typeof jsPDF> | undefined;
  for (const canvas of canvases) {
    const orientacao = canvas.width >= canvas.height ? "landscape" : "portrait";
    if (!doc) {
      doc = new jsPDF({ orientation: orientacao, unit: "px", format: [canvas.width, canvas.height] });
    } else {
      doc.addPage([canvas.width, canvas.height], orientacao);
    }
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
  }
  doc!.save(nomeArquivo);
}

/** Nome de arquivo seguro a partir do nome do cliente. */
export function slugArquivo(texto: string): string {
  // Remove acentos sem depender de um literal regex com marcas de
  // combinacao Unicode no proprio arquivo-fonte (fragil entre encodings).
  const semAcento = Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const codigo = ch.codePointAt(0) ?? 0;
      return codigo < 0x0300 || codigo > 0x036f;
    })
    .join("");

  return (
    semAcento
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "croqui"
  );
}
