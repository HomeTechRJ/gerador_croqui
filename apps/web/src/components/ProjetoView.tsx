import { useEffect, useState } from "react";
import type { Projeto } from "@croqui/shared";
import { criarProjeto, listarProjetos } from "../api";

interface Props {
  onSelecionar: (projeto: Projeto) => void;
}

export function ProjetoView({ onSelecionar }: Props) {
  const [nomeCliente, setNomeCliente] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);

  useEffect(() => {
    listarProjetos()
      .then(setProjetos)
      .catch(() => setProjetos([]));
  }, []);

  async function handleCriar(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeCliente.trim()) return;
    setErro(null);
    setCriando(true);
    try {
      const projeto = await criarProjeto(nomeCliente.trim());
      onSelecionar(projeto);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao criar o projeto.");
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="upload-view">
      <header className="upload-header">
        <p className="eyebrow">Gerador de Croqui</p>
        <h1>Qual projeto vamos montar?</h1>
        <p className="subtitulo">Cada projeto guarda suas plantas, o questionário e o histórico de versões do croqui.</p>
      </header>

      <form className="form-projeto" onSubmit={handleCriar}>
        <input
          type="text"
          placeholder="Nome do cliente (ex: Izabela e Rodrigo)"
          value={nomeCliente}
          onChange={(e) => setNomeCliente(e.target.value)}
          disabled={criando}
        />
        <button type="submit" disabled={criando || !nomeCliente.trim()}>
          {criando ? "Criando…" : "Novo projeto"}
        </button>
      </form>

      {erro && <p className="erro" role="alert">{erro}</p>}

      {projetos && projetos.length > 0 && (
        <div className="lista-projetos">
          <p className="eyebrow">Projetos recentes</p>
          <ul>
            {projetos.map((p) => (
              <li key={p.id}>
                <button type="button" className="item-projeto" onClick={() => onSelecionar(p)}>
                  <span>{p.nomeCliente}</span>
                  <span className="data-projeto">{new Date(p.atualizadoEm).toLocaleDateString("pt-BR")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
