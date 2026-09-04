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

/** Um simbolo da legenda (equipamento) que pode ser posicionado no croqui. */
export interface SymbolDefinition {
  id: string;
  categoria: ServiceCategory;
  nome: string; // ex: "Caixa de som embutida"
  /** Caminho do SVG do simbolo (relativo a pasta de assets de simbolos). */
  svgPath: string;
}

/** Respostas do questionario inicial, que define quais simbolos ficam disponiveis. */
export interface QuestionarioProjeto {
  projetoId: string;
  servicos: ServiceCategory[];
  observacoes?: string;
}

/** Formatos de planta aceitos na importacao. */
export type FormatoPlanta = "pdf" | "dwg" | "dxf";

export interface PlantaImportada {
  id: string;
  projetoId: string;
  formatoOriginal: FormatoPlanta;
  /** Caminho do arquivo ja convertido para exibicao (pdf ou dxf). */
  arquivoProcessadoPath: string;
  criadoEm: string;
}

export interface Projeto {
  id: string;
  nomeCliente: string;
  criadoEm: string;
  atualizadoEm: string;
}
