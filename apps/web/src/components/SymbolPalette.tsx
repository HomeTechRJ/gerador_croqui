import type { ServiceCategory, SymbolDefinition } from "@croqui/shared";
import { SIMBOLOS_PADRAO } from "@croqui/shared";

interface Props {
  servicosPermitidos: ServiceCategory[];
  simboloAtivoId: string | null;
  onSelecionar: (simbolo: SymbolDefinition) => void;
}

const ROTULO_CATEGORIA: Record<ServiceCategory, string> = {
  audio: "Áudio",
  video: "Vídeo",
  rede: "Rede",
  automacao: "Automação",
  seguranca: "Segurança",
  energia: "Energia",
};

export function SymbolPalette({ servicosPermitidos, simboloAtivoId, onSelecionar }: Props) {
  const categorias = servicosPermitidos.filter((c) =>
    SIMBOLOS_PADRAO.some((s) => s.categoria === c)
  );

  if (categorias.length === 0) {
    return (
      <p className="palette-vazia">
        Nenhum símbolo disponível — volte ao questionário e marque ao menos um serviço.
      </p>
    );
  }

  return (
    <div className="palette">
      {categorias.map((categoria) => (
        <div key={categoria} className="palette-grupo">
          <p className="palette-grupo-titulo">{ROTULO_CATEGORIA[categoria]}</p>
          <div className="palette-itens">
            {SIMBOLOS_PADRAO.filter((s) => s.categoria === categoria).map((simbolo) => (
              <button
                key={simbolo.id}
                type="button"
                className={`palette-item${simboloAtivoId === simbolo.id ? " ativo" : ""}`}
                onClick={() => onSelecionar(simbolo)}
                title={simbolo.confirmado ? simbolo.nome : `${simbolo.nome} (proposto)`}
              >
                <span className={`mini-forma ${simbolo.forma}`} style={{ background: simbolo.cor }} />
                {simbolo.nome}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
