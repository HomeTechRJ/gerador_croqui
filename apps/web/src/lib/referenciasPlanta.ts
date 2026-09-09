import type { AmbienteDetectado } from './detectarAmbientes';

export interface PosicaoReferencia {
  x: number;
  y: number;
}

export interface ReferenciaAmbiente {
  id: string;
  caixas: PosicaoReferencia[];
  rede: PosicaoReferencia[];
}

interface ViewportReferencia {
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * Calibracao do PDF real, conforme a imagem enviada como "resultado final".
 * Coordenadas em pontos PDF (origem inferior esquerda), nao no retangulo
 * estimado do detector. O hash impede aplicar este layout a outro quarto
 * de mesmo nome. Reenvios identicos do arquivo mantem a referencia.
 */
const QUARTO_MENINAS = {
  sha256: 'f8508c1fab627d343f4772613dd2ae735bd7a351e520b6a79f82f4a4fe242087',
  nome: 'QUARTO DAS MENINAS',
  rotulo: [371.28, 270.6],
  caixas: [[350, 272], [437, 272]],
  rede: [[338, 303.5], [348, 303.5]],
} as const;

const ESCRITORIO = {
  sha256: 'f8508c1fab627d343f4772613dd2ae735bd7a351e520b6a79f82f4a4fe242087',
  nome: 'ESCRITÓRIO',
  rotulo: [418.68, 975],
  // Dois pontos ficam nos computadores indicados pelo usuário; o terceiro
  // fica imediatamente ao lado do computador esquerdo, na mesma bancada,
  // para uma possível impressora.
  caixas: [],
  rede: [[405, 1010], [412, 1010], [449.5, 1010]],
} as const;

const REFERENCIAS = [QUARTO_MENINAS, ESCRITORIO] as const;

export function aplicarReferenciasDaPlanta(
  ambientes: AmbienteDetectado[],
  sha256: string,
  viewport: ViewportReferencia
): AmbienteDetectado[] {
  const referenciasDaPlanta = REFERENCIAS.filter((referencia) => referencia.sha256 === sha256.toLowerCase());
  if (referenciasDaPlanta.length === 0) return ambientes;
  const converter = ([x, y]: readonly [number, number]): PosicaoReferencia => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    return { x: vx, y: vy };
  };
  return ambientes.map((ambiente) => {
    const referencia = referenciasDaPlanta.find(
      (item) => item.nome === ambiente.nome.trim().toUpperCase()
    );
    if (!referencia) return ambiente;
    const rotulo = converter(referencia.rotulo);
    if (Math.hypot(ambiente.posX - rotulo.x, ambiente.posY - rotulo.y) > 30) return ambiente;
    return {
      ...ambiente,
      referencia: {
        id: referencia === ESCRITORIO ? 'escritorio-referencia-final-v1' : 'quarto-meninas-referencia-final-v1',
        caixas: referencia.caixas.map(converter),
        rede: referencia.rede.map(converter),
      },
    };
  });
}
