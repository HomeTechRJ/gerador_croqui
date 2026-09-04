import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { PlantaImportada } from "@croqui/shared";
import { enviarPlanta } from "../api";

interface Props {
  onImportada: (planta: PlantaImportada) => void;
}

export function UploadView({ onImportada }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function processarArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      const planta = await enviarPlanta(arquivo);
      if (planta.status === "erro_conversao") {
        setErro(planta.mensagemErro ?? "Falha ao converter o arquivo.");
        return;
      }
      onImportada(planta);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao enviar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    processarArquivo(e.dataTransfer.files[0]);
  }

  return (
    <div className="upload-view">
      <header className="upload-header">
        <p className="eyebrow">Gerador de Croqui</p>
        <h1>Importe a planta do cliente</h1>
        <p className="subtitulo">Aceita PDF, DXF ou DWG (o DWG é convertido automaticamente).</p>
      </header>

      <div
        className={`dropzone${arrastando ? " arrastando" : ""}${enviando ? " enviando" : ""}`}
        onClick={() => !enviando && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={handleDrop}
      >
        <span className="dropzone-icone" aria-hidden="true">
          📐
        </span>
        <span className="dropzone-texto">
          {enviando ? "Enviando e processando…" : "Clique ou arraste o arquivo aqui"}
        </span>
        <span className="dropzone-formatos">.pdf · .dxf · .dwg</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.dxf,.dwg"
        hidden
        onChange={(e) => processarArquivo(e.target.files?.[0])}
      />

      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  );
}
