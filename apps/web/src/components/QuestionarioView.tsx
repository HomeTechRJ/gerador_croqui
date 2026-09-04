import { useState } from "react";
import type { Projeto, ServiceCategory } from "@croqui/shared";
import { SIMBOLOS_PADRAO } from "@croqui/shared";
import { salvarQuestionario } from "../api";

interface Props {
  projeto: Projeto;
  onConcluido: () => void;
}

const OPCOES: { valor: ServiceCategory; rotulo: string }[] = [
  { valor: "audio", rotulo: "Áudio" },
  { valor: "video", rotulo: "Vídeo" },
  { valor: "rede", rotulo: "Rede" },
  { valor: "automacao", rotulo: "Automação" },
  { valor: "seguranca", rotulo: "Segurança" },
  { valor: "energia", rotulo: "Energia" },
];

export function QuestionarioView({ projeto, onConcluido }: Props) {
  const [selecionados, setSelecionados] = useState<Set<ServiceCategory>>(new Set());
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  function alternar(servico: ServiceCategory) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(servico)) novo.delete(servico);
      else novo.add(servico);
      return novo;
    });
  }

  async function handleSalvar() {
    setErro(null);
    setSalvando(true);
    try {
      await salvarQuestionario(projeto.id, [...selecionados], observacoes);
      setSalvo(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const simbolosDisponiveis = SIMBOLOS_PADRAO.filter((s) => selecionados.has(s.categoria));

  return (
    <div className="upload-view">
      <header className="upload-header">
        <p className="eyebrow">{projeto.nomeCliente}</p>
        <h1>O que o cliente contratou?</h1>
        <p className="subtitulo">Isso define quais símbolos ficam disponíveis pra montar o croqui.</p>
      </header>

      {!salvo ? (
        <>
          <div className="opcoes-servico">
            {OPCOES.map((o) => (
              <label key={o.valor} className={`opcao-servico${selecionados.has(o.valor) ? " marcada" : ""}`}>
                <input
                  type="checkbox"
                  checked={selecionados.has(o.valor)}
                  onChange={() => alternar(o.valor)}
                />
                {o.rotulo}
              </label>
            ))}
          </div>

          <textarea
            className="observacoes-textarea"
            placeholder="Observações (opcional)"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
          />

          <button type="button" onClick={handleSalvar} disabled={salvando || selecionados.size === 0}>
            {salvando ? "Salvando…" : "Salvar e continuar"}
          </button>

          {erro && <p className="erro" role="alert">{erro}</p>}
        </>
      ) : (
        <>
          <p className="subtitulo">
            {simbolosDisponiveis.length} símbolos disponíveis pra este projeto:
          </p>
          <div className="preview-simbolos">
            {simbolosDisponiveis.map((s) => (
              <span key={s.id} className="chip-simbolo">
                <span
                  className={`mini-forma ${s.forma}`}
                  style={{ background: s.cor }}
                  aria-hidden="true"
                />
                {s.nome}
              </span>
            ))}
          </div>
          <button type="button" onClick={onConcluido}>
            Ver a planta →
          </button>
        </>
      )}
    </div>
  );
}
