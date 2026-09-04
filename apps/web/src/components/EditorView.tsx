import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { Croqui, PlantaImportada, Projeto, QuestionarioProjeto, SymbolDefinition } from "@croqui/shared";
import { SIMBOLOS_PADRAO } from "@croqui/shared";
import {
  buscarCroqui,
  buscarQuestionario,
  enviarPlanta,
  listarPlantasDoProjeto,
  listarVersoesCroqui,
  salvarVersaoCroqui,
  urlArquivoPlanta,
} from "../api";
import { SymbolPalette } from "./SymbolPalette";
import {
  baixarCanvasComoPng,
  baixarCanvasesComoPdf,
  renderizarPaginaCroqui,
  slugArquivo,
} from "../lib/exportarCroqui";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface Props {
  projeto: Projeto;
  plantaInicial: PlantaImportada;
  onVoltar: () => void;
}

interface PontoLocal {
  id: string;
  plantaId: string;
  simboloId: string;
  posX: number;
  posY: number;
  rotacao: number;
}

const ESCALA_MIN = 0.2;
const ESCALA_MAX = 8;
const LIMIAR_CLIQUE_PX = 5;

export function EditorView({ projeto, plantaInicial, onVoltar }: Props) {
  const [plantas, setPlantas] = useState<PlantaImportada[]>([plantaInicial]);
  const [plantaAtivaId, setPlantaAtivaId] = useState(plantaInicial.id);
  const [questionario, setQuestionario] = useState<QuestionarioProjeto | null>(null);
  const [simboloAtivo, setSimboloAtivo] = useState<SymbolDefinition | null>(null);
  const [pontos, setPontos] = useState<PontoLocal[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [versoes, setVersoes] = useState<Croqui[]>([]);
  const [versaoCarregada, setVersaoCarregada] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [exportando, setExportando] = useState<"png" | "pdf" | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputPlantaRef = useRef<HTMLInputElement>(null);

  const [transform, setTransform] = useState({ escala: 1, x: 0, y: 0 });
  const [tamanhoCanvas, setTamanhoCanvas] = useState({ largura: 0, altura: 0 });
  const [carregandoPdf, setCarregandoPdf] = useState(true);

  const arraste = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const cliqueCandidato = useRef(false);
  const arrastePonto = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const rotacionandoId = useRef<string | null>(null);

  const plantaAtiva = plantas.find((p) => p.id === plantaAtivaId) ?? plantaInicial;

  // Carrega plantas do projeto, questionario e a ultima versao salva (se houver).
  useEffect(() => {
    listarPlantasDoProjeto(projeto.id).then((lista) => {
      if (lista.length > 0) setPlantas(lista);
    });
    buscarQuestionario(projeto.id).then(setQuestionario);
    listarVersoesCroqui(projeto.id).then(async (lista) => {
      setVersoes(lista);
      if (lista.length > 0) {
        const ultima = await buscarCroqui(lista[0].id);
        setPontos(
          ultima.pontos.map((p) => ({
            id: p.id,
            plantaId: p.plantaId ?? plantaInicial.id,
            simboloId: p.simboloId,
            posX: p.posX,
            posY: p.posY,
            rotacao: p.rotacao,
          }))
        );
        setVersaoCarregada(ultima.croqui.versao);
      }
    });
  }, [projeto.id, plantaInicial.id]);

  // Renderiza a planta ativa (PDF) no canvas.
  useEffect(() => {
    if (plantaAtiva.formatoExibicao !== "pdf") {
      setCarregandoPdf(false);
      return;
    }

    let cancelado = false;
    setCarregandoPdf(true);
    setErro(null);

    (async () => {
      try {
        const documento = await pdfjsLib.getDocument(urlArquivoPlanta(plantaAtiva.id)).promise;
        const pagina = await documento.getPage(1);
        const viewport = pagina.getViewport({ scale: 2 });

        const canvas = canvasRef.current;
        if (!canvas || cancelado) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const contexto = canvas.getContext("2d");
        if (!contexto) return;

        await pagina.render({ canvasContext: contexto, viewport }).promise;
        if (cancelado) return;
        setTamanhoCanvas({ largura: viewport.width, altura: viewport.height });
        setTransform({ escala: 1, x: 0, y: 0 });
        setCarregandoPdf(false);
      } catch (err) {
        if (!cancelado) {
          setErro(err instanceof Error ? err.message : "Falha ao renderizar o PDF.");
          setCarregandoPdf(false);
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [plantaAtiva]);

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

  // ---- pan da planta + colocar ponto novo (clique em area vazia) ----

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    // Clique dentro de um ponto (forma, alca de girar ou botao de excluir) e
    // tratado pelos handlers do proprio ponto - nao inicia arraste da planta,
    // senao o pointerup perde a referencia ao elemento original
    // (setPointerCapture redireciona os eventos seguintes pro wrapper).
    if ((e.target as HTMLElement).closest(".ponto-item")) {
      cliqueCandidato.current = false;
      return;
    }
    arraste.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
    cliqueCandidato.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!arraste.current) return;
    const dx = e.clientX - arraste.current.startX;
    const dy = e.clientY - arraste.current.startY;
    if (Math.abs(dx) > LIMIAR_CLIQUE_PX || Math.abs(dy) > LIMIAR_CLIQUE_PX) {
      cliqueCandidato.current = false;
    }
    setTransform((t) => ({ ...t, x: arraste.current!.origX + dx, y: arraste.current!.origY + dy }));
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    arraste.current = null;
    const foiClique = cliqueCandidato.current;
    cliqueCandidato.current = false;
    if (!foiClique) return;
    if ((e.target as HTMLElement).closest(".ponto-item")) return;

    setSelecionadoId(null);

    if (!simboloAtivo) {
      setMensagem("Selecione um símbolo na paleta antes de clicar na planta.");
      return;
    }
    if (!stageRef.current) return;

    const rect = stageRef.current.getBoundingClientRect();
    const posX = ((e.clientX - rect.left) / rect.width) * tamanhoCanvas.largura;
    const posY = ((e.clientY - rect.top) / rect.height) * tamanhoCanvas.altura;

    setPontos((atual) => [
      ...atual,
      { id: crypto.randomUUID(), plantaId: plantaAtivaId, simboloId: simboloAtivo.id, posX, posY, rotacao: 0 },
    ]);
    setMensagem(null);
  }

  function removerPonto(id: string) {
    setPontos((atual) => atual.filter((p) => p.id !== id));
    setSelecionadoId((atual) => (atual === id ? null : atual));
  }

  // ---- mover um ponto ja colocado (arrastar a propria forma) ----

  function handleMarcadorPointerDown(e: PointerEvent<HTMLDivElement>, ponto: PontoLocal) {
    e.stopPropagation();
    setSelecionadoId(ponto.id);
    arrastePonto.current = { id: ponto.id, startX: e.clientX, startY: e.clientY, origX: ponto.posX, origY: ponto.posY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleMarcadorPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!arrastePonto.current) return;
    const { id, startX, startY, origX, origY } = arrastePonto.current;
    const dx = (e.clientX - startX) / transform.escala;
    const dy = (e.clientY - startY) / transform.escala;
    setPontos((atual) => atual.map((p) => (p.id === id ? { ...p, posX: origX + dx, posY: origY + dy } : p)));
  }

  function handleMarcadorPointerUp() {
    arrastePonto.current = null;
  }

  // ---- girar um ponto (arrastar a alca de rotacao) ----

  function handleRotacaoPointerDown(e: PointerEvent<HTMLDivElement>, ponto: PontoLocal) {
    e.stopPropagation();
    rotacionandoId.current = ponto.id;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleRotacaoPointerMove(e: PointerEvent<HTMLDivElement>, ponto: PontoLocal) {
    if (rotacionandoId.current !== ponto.id || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const centroX = rect.left + (ponto.posX / tamanhoCanvas.largura) * rect.width;
    const centroY = rect.top + (ponto.posY / tamanhoCanvas.altura) * rect.height;
    const anguloTela = Math.atan2(e.clientY - centroY, e.clientX - centroX) * (180 / Math.PI);
    const rotacao = ((anguloTela + 90) % 360 + 360) % 360;
    setPontos((atual) => atual.map((p) => (p.id === ponto.id ? { ...p, rotacao } : p)));
  }

  function handleRotacaoPointerUp() {
    rotacionandoId.current = null;
  }

  // ---- salvar/carregar versoes ----

  async function handleSalvarVersao() {
    setSalvando(true);
    setErro(null);
    setMensagem(null);
    try {
      const payload = pontos.map((p) => ({
        plantaId: p.plantaId,
        simboloId: p.simboloId,
        posX: p.posX,
        posY: p.posY,
        rotacao: p.rotacao,
      }));
      const novaVersao = await salvarVersaoCroqui(projeto.id, payload);
      setVersoes((atual) => [novaVersao, ...atual]);
      setVersaoCarregada(novaVersao.versao);
      setMensagem(`Versão ${novaVersao.versao} salva.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar a versão.");
    } finally {
      setSalvando(false);
    }
  }

  // ---- exportar (Fase 5) ----

  async function handleExportarPng() {
    if (plantaAtiva.formatoExibicao !== "pdf") {
      setErro("Só dá pra exportar plantas em PDF por enquanto.");
      return;
    }
    setExportando("png");
    setErro(null);
    setMensagem(null);
    try {
      const canvas = await renderizarPaginaCroqui(plantaAtiva, pontosDaPlantaAtiva, simbolosPorId);
      const nomePlanta = slugArquivo(plantaAtiva.nomeArquivoOriginal.replace(/\.[^.]+$/, ""));
      baixarCanvasComoPng(canvas, `croqui-${slugArquivo(projeto.nomeCliente)}-${nomePlanta}.png`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao exportar PNG.");
    } finally {
      setExportando(null);
    }
  }

  async function handleExportarPdf() {
    const plantasExportaveis = plantas.filter((p) => p.formatoExibicao === "pdf");
    if (plantasExportaveis.length === 0) {
      setErro("Nenhuma planta em PDF disponível pra exportar.");
      return;
    }
    setExportando("pdf");
    setErro(null);
    setMensagem(null);
    try {
      const canvases = await Promise.all(
        plantasExportaveis.map((p) =>
          renderizarPaginaCroqui(
            p,
            pontos.filter((pt) => pt.plantaId === p.id),
            simbolosPorId
          )
        )
      );
      await baixarCanvasesComoPdf(canvases, `croqui-${slugArquivo(projeto.nomeCliente)}.pdf`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao exportar PDF.");
    } finally {
      setExportando(null);
    }
  }

  async function handleCarregarVersao(versaoId: string) {
    const alvo = versoes.find((v) => v.id === versaoId);
    if (!alvo) return;
    const resultado = await buscarCroqui(alvo.id);
    setPontos(
      resultado.pontos.map((p) => ({
        id: p.id,
        plantaId: p.plantaId ?? plantaAtivaId,
        simboloId: p.simboloId,
        posX: p.posX,
        posY: p.posY,
        rotacao: p.rotacao,
      }))
    );
    setSelecionadoId(null);
    setVersaoCarregada(resultado.croqui.versao);
    setMensagem(`Carregada a versão ${resultado.croqui.versao} (edite e salve pra criar uma nova).`);
  }

  async function handleAdicionarPlanta(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    try {
      const planta = await enviarPlanta(projeto.id, arquivo);
      if (planta.status === "erro_conversao") {
        setErro(planta.mensagemErro ?? "Falha ao converter o arquivo.");
        return;
      }
      setPlantas((atual) => [...atual, planta]);
      setPlantaAtivaId(planta.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao enviar o arquivo.");
    }
  }

  const pontosDaPlantaAtiva = useMemo(
    () => pontos.filter((p) => p.plantaId === plantaAtivaId),
    [pontos, plantaAtivaId]
  );

  const simbolosPorId = useMemo(() => {
    const mapa = new Map<string, SymbolDefinition>();
    for (const s of SIMBOLOS_PADRAO) mapa.set(s.id, s);
    return mapa;
  }, []);

  return (
    <div className="viewer">
      <header className="viewer-toolbar">
        <button type="button" onClick={onVoltar}>
          ← Projetos
        </button>
        <span className="nome-arquivo">{projeto.nomeCliente}</span>

        {versoes.length > 0 && (
          <select
            className="select-versao"
            value={versoes.find((v) => v.versao === versaoCarregada)?.id ?? ""}
            onChange={(e) => handleCarregarVersao(e.target.value)}
          >
            {versoes.map((v) => (
              <option key={v.id} value={v.id}>
                Versão {v.versao} · {new Date(v.criadoEm).toLocaleString("pt-BR")}
              </option>
            ))}
          </select>
        )}

        <button type="button" onClick={handleSalvarVersao} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar versão"}
        </button>
        <button type="button" onClick={handleExportarPng} disabled={exportando !== null}>
          {exportando === "png" ? "Gerando…" : "Exportar PNG"}
        </button>
        <button type="button" onClick={handleExportarPdf} disabled={exportando !== null}>
          {exportando === "pdf" ? "Gerando…" : "Exportar PDF"}
        </button>
      </header>

      <div className="planta-tabs">
        {plantas.length > 1
          ? plantas.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`planta-tab${p.id === plantaAtivaId ? " ativa" : ""}`}
                onClick={() => setPlantaAtivaId(p.id)}
              >
                {p.nomeArquivoOriginal}
              </button>
            ))
          : <span className="planta-tab ativa">{plantaAtiva.nomeArquivoOriginal}</span>}
        <button type="button" className="planta-tab planta-tab-add" onClick={() => inputPlantaRef.current?.click()}>
          + Planta
        </button>
      </div>
      <input
        ref={inputPlantaRef}
        type="file"
        accept=".pdf,.dxf,.dwg"
        hidden
        onChange={(e) => handleAdicionarPlanta(e.target.files?.[0])}
      />

      {(mensagem || erro) && (
        <p className={erro ? "erro" : "aviso-inline"} role="status">
          {erro ?? mensagem}
        </p>
      )}

      <div className="editor-body">
        <aside className="editor-sidebar">
          <SymbolPalette
            servicosPermitidos={questionario?.servicos ?? []}
            simboloAtivoId={simboloAtivo?.id ?? null}
            onSelecionar={(s) => {
              setSimboloAtivo(s);
              setSelecionadoId(null);
            }}
          />
          {selecionadoId && (
            <p className="dica-editor">Arraste o símbolo selecionado pra mover, ou a bolinha acima dele pra girar.</p>
          )}
        </aside>

        {plantaAtiva.formatoExibicao === "dxf" ? (
          <div className="aviso">
            Visualização de DXF ainda não implementada — dá pra escolher os símbolos, mas
            posicionar só funciona em plantas PDF por enquanto.
          </div>
        ) : (
          <div
            ref={wrapperRef}
            className="canvas-wrapper"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              arraste.current = null;
              cliqueCandidato.current = false;
            }}
          >
            {carregandoPdf && <p className="status-render">Carregando planta…</p>}
            <div
              ref={stageRef}
              className="canvas-stage"
              style={{
                width: tamanhoCanvas.largura,
                height: tamanhoCanvas.altura,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.escala})`,
                visibility: carregandoPdf ? "hidden" : "visible",
              }}
            >
              <canvas ref={canvasRef} className="canvas-planta-base" />
              <div className="pontos-layer">
                {pontosDaPlantaAtiva.map((p) => {
                  const simbolo = simbolosPorId.get(p.simboloId);
                  if (!simbolo) return null;
                  const selecionado = p.id === selecionadoId;
                  return (
                    <div key={p.id} className="ponto-item" style={{ left: p.posX, top: p.posY }}>
                      <div className="ponto-forma-wrap" style={{ transform: `rotate(${p.rotacao}deg)` }}>
                        <div
                          className={`ponto-marcador ${simbolo.forma}${selecionado ? " selecionado" : ""}`}
                          style={{ background: simbolo.cor }}
                          title={simbolo.nome}
                          onPointerDown={(e) => handleMarcadorPointerDown(e, p)}
                          onPointerMove={handleMarcadorPointerMove}
                          onPointerUp={handleMarcadorPointerUp}
                        />
                        {selecionado && (
                          <div
                            className="ponto-handle-rotacionar"
                            title="Arraste pra girar"
                            onPointerDown={(e) => handleRotacaoPointerDown(e, p)}
                            onPointerMove={(e) => handleRotacaoPointerMove(e, p)}
                            onPointerUp={handleRotacaoPointerUp}
                          />
                        )}
                      </div>
                      {selecionado && (
                        <button
                          type="button"
                          className="ponto-handle-excluir"
                          title="Remover"
                          onClick={() => removerPonto(p.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
