const ESCALA_PADRAO = 2;
const MAIOR_LADO_MAXIMO_PX = 4000;

interface PaginaComViewport {
  getViewport: (params: { scale: number }) => { width: number; height: number };
}

/**
 * Escala de renderizacao usada em TODO lugar que desenha uma pagina de PDF
 * (editor, deteccao de ambientes, exportacao) - tem que ser sempre a mesma
 * em todos os tres, senao a posicao dos pontos/ambientes desalinha do
 * canvas visivel.
 *
 * Normalmente fica fixa em 2x (boa resolucao, arquivo leve). Mas se a
 * pagina do PDF tiver um MediaBox anormalmente grande (alguns exportadores
 * de CAD geram isso por engano), 2x poderia gerar um canvas maior que o
 * limite do navegador - e o resultado eh uma tela em branco, sem nenhum
 * erro no console. Por isso o teto: nunca deixa o lado maior passar de
 * MAIOR_LADO_MAXIMO_PX, reduzindo a escala proporcionalmente se precisar.
 */
export function calcularEscalaRenderizacao(pagina: PaginaComViewport): number {
  const base = pagina.getViewport({ scale: 1 });
  const maiorLado = Math.max(base.width, base.height);
  if (maiorLado <= 0) return ESCALA_PADRAO;
  return Math.min(ESCALA_PADRAO, MAIOR_LADO_MAXIMO_PX / maiorLado);
}
