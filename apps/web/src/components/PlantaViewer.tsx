import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PlantaImportada } from "@croqui/shared";
import { urlArquivoPlanta } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface Props {
  planta: PlantaImportada;
  onVoltar: () => void;
}

const ESCALA_MIN = 0.2;
const ESCALA_MAX = 8;

export function PlantaViewer({ planta, onVoltar }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ escala: 1, x: 0, y: 0 });
  const [carregando, setCarregando] = useState(true);
  const [erroRender, setErroRender] = useState<string | null>(null);
  const arraste = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  useEffect(() => {
    if (planta.formatoExibicao !== "pdf") {
      setCarregando(false);
      return;
    }

    let cancelado = false;
    setCarregando(true);
    setErroRender(null);

    (async () => {
      try {
        const documento = await pdfjsLib.getDocument(urlArquivoPlanta(planta.id)).promise;
        const pagina = await documento.getPage(1);
        const viewport = pagina.getViewport({ scale: 2 });

        const canvas = canvasRef.current;
        if (!canvas || cancelado) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const contexto = canvas.getContext("2d");
        if (!contexto) return;

        await pagina.render({ canvasContext: contexto, viewport }).promise;
        if (!cancelado) setCarregando(false);
      } catch (err) {
        if (!cancelado) {
          setErroRender(err instanceof Error ? err.message : "Falha ao renderizar o PDF.");
          setCarregando(false);
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [planta]);

  // O React anexa onWheel como listener passivo (nao da pra chamar
  // preventDefault nele), entao o zoom por scroll precisa de um listener
  // nativo registrado com { passive: false }.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const fator = e.deltaY < 0 ? 1.1 : 0.9;
      setTransform((t) => ({ ...t, escala: Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, t.escala * fator)) }));
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    arraste.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!arraste.current) return;
    const dx = e.clientX - arraste.current.startX;
    const dy = e.clientY - arraste.current.startY;
    setTransform((t) => ({ ...t, x: arraste.current!.origX + dx, y: arraste.current!.origY + dy }));
  }

  function handlePointerUp() {
    arraste.current = null;
  }

  return (
    <div className="viewer">
      <header className="viewer-toolbar">
        <button type="button" onClick={onVoltar}>
          ← Projetos
        </button>
        <span className="nome-arquivo">{planta.nomeArquivoOriginal}</span>
        <button type="button" onClick={() => setTransform({ escala: 1, x: 0, y: 0 })}>
          Centralizar
        </button>
      </header>

      {planta.formatoExibicao === "dxf" ? (
        <div className="aviso">
          Visualização de DXF ainda não implementada nesta fase — chega na Fase 1.1.
          <br />
          O arquivo já foi convertido e está salvo no servidor.
        </div>
      ) : (
        <div
          ref={wrapperRef}
          className="canvas-wrapper"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {carregando && <p className="status-render">Carregando planta…</p>}
          {erroRender && <p className="erro">{erroRender}</p>}
          <canvas
            ref={canvasRef}
            className="canvas-planta"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.escala})`,
              visibility: carregando ? "hidden" : "visible",
            }}
          />
        </div>
      )}
    </div>
  );
}
