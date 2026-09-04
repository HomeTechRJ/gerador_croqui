// Tipos compartilhados entre o front-end (apps/web) e a API (apps/api).
// Este pacote nao tem build proprio por enquanto: e consumido como TS puro
// (Vite e tsx sabem transpilar direto). Se um dia precisar publicar/isolar,
// adicionamos um tsconfig + tsup aqui.

/** Categorias de servico que o cliente pode ter contratado no projeto. */
export type ServiceCategory =
  | "audio"
  | "video"
  | "rede"
  | "automacao"
  | "seguranca"
  | "energia";

/** Forma geometrica usada para desenhar o simbolo no croqui (ver legenda-ht). */
export type SymbolShape = "circulo" | "quadrado" | "retangulo";

/** Um simbolo da legenda (equipamento) que pode ser posicionado no croqui. */
export interface SymbolDefinition {
  id: string;
  categoria: ServiceCategory;
  nome: string; // ex: "Caixa de embutir (teto)"
  forma: SymbolShape;
  /** Cor solida do simbolo, em hex. */
  cor: string;
  /** false = cor/forma ainda nao validada em um croqui real, so proposta. */
  confirmado: boolean;
}

/**
 * Paleta oficial de simbolos, aprovada em 04/09/2026 a partir dos croquis de
 * referencia. Cor + forma sao fixas para todo croqui novo daqui pra frente
 * (nao customizavel por projeto) - ver artifact "Legenda HT".
 */
export const SIMBOLOS_PADRAO: SymbolDefinition[] = [
  // Audio
  { id: "caixa-embutir", categoria: "audio", nome: "Caixa de embutir (teto)", forma: "circulo", cor: "#D6362A", confirmado: true },
  { id: "caixa-oculta", categoria: "audio", nome: "Caixa oculta", forma: "circulo", cor: "#E5A23D", confirmado: true },
  { id: "caixa-embutir-bluetooth", categoria: "audio", nome: "Caixa embutir bluetooth", forma: "circulo", cor: "#8B4FA6", confirmado: true },
  { id: "caixa-outdoor-sauna", categoria: "audio", nome: "Caixa outdoor / sauna", forma: "quadrado", cor: "#202225", confirmado: true },
  { id: "caixa-bookshelf", categoria: "audio", nome: "Caixa bookshelf", forma: "circulo", cor: "#7A4B3A", confirmado: false },
  { id: "subwoofer", categoria: "audio", nome: "Subwoofer", forma: "quadrado", cor: "#7A1F2B", confirmado: false },
  { id: "receiver", categoria: "audio", nome: "Receiver", forma: "retangulo", cor: "#2F8F4E", confirmado: true },
  { id: "multiroom", categoria: "audio", nome: "Multiroom", forma: "retangulo", cor: "#1FA6A6", confirmado: true },
  // Rede
  { id: "ponto-de-rede", categoria: "rede", nome: "Ponto de rede", forma: "quadrado", cor: "#2C6FBD", confirmado: true },
  { id: "unifi-ap", categoria: "rede", nome: "Unifi AP", forma: "circulo", cor: "#1E88E5", confirmado: true },
  // Automacao
  { id: "quadro-automacao", categoria: "automacao", nome: "Quadro de automação", forma: "retangulo", cor: "#C97A2D", confirmado: true },
];

/** Respostas do questionario inicial, que define quais simbolos ficam disponiveis. */
export interface QuestionarioProjeto {
  projetoId: string;
  servicos: ServiceCategory[];
  observacoes?: string;
}

/** Formatos de planta aceitos na importacao. */
export type FormatoPlanta = "pdf" | "dwg" | "dxf";

/**
 * pronta: ja da pra visualizar (pdf/dxf, ou dwg convertido com sucesso).
 * convertendo: dwg em processo de conversao pelo ODA File Converter.
 * erro_conversao: dwg recebido mas a conversao falhou ou o conversor nao
 * esta configurado no servidor (ver ODA_CONVERTER_PATH em apps/api).
 */
export type StatusPlanta = "pronta" | "convertendo" | "erro_conversao";

export interface PlantaImportada {
  id: string;
  projetoId: string;
  formatoOriginal: FormatoPlanta;
  status: StatusPlanta;
  /** Nome original do arquivo enviado. */
  nomeArquivoOriginal: string;
  /** Formato do arquivo pronto pra visualizacao (pdf ou dxf), quando status = pronta. */
  formatoExibicao?: "pdf" | "dxf";
  mensagemErro?: string;
  criadoEm: string;
}

export interface Projeto {
  id: string;
  nomeCliente: string;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Uma versao salva do croqui de um projeto. Cada vez que o usuario salva o
 * arranjo de simbolos, gravamos uma versao nova (nao sobrescreve) - e assim
 * que o "controle de versao" funciona: da pra comparar/voltar pra versao
 * anterior depois.
 */
export interface Croqui {
  id: string;
  projetoId: string;
  versao: number;
  observacoes?: string;
  criadoEm: string;
}

/** Um simbolo posicionado sobre uma planta, dentro de uma versao do croqui. */
export interface CroquiPonto {
  id: string;
  croquiId: string;
  plantaId?: string;
  /** Referencia o id de um item de SIMBOLOS_PADRAO. */
  simboloId: string;
  ambiente?: string;
  posX: number;
  posY: number;
  criadoEm: string;
}

/** Payload de entrada pra criar um ponto ao salvar uma nova versao do croqui. */
export interface NovoCroquiPonto {
  plantaId?: string;
  simboloId: string;
  ambiente?: string;
  posX: number;
  posY: number;
}
