import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
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
import { MIME_SIMBOLO_ID, SymbolPalette } from "./SymbolPalette";
import {
  baixarCanvasComoPng,
  baixarCanvasesComoPdf,
  renderizarPaginaCroqui,
  slugArquivo,
} from "../lib/exportarCroqui";
import { ambienteMaisProximo, detectarAmbientes } from "../lib/detectarAmbientes";
import type { AmbienteDetectado } from "../lib/detectarAmbientes";
import {
  calcularPosicoesDaSugestao,
  sugerirParaAmbiente,
  sugerirParaAndar,
  sugerirPeloBriefing,
} from "../lib/motorDeRegras";
import { calcularEscalaRenderizacao } from "../lib/pdfRender";
import type { PDFPageProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface Props {
  projeto: Projeto;
  plantaInicial: PlantaImportada;
  /** Rascunho preservado ao editar o briefing e voltar para a planta. */
  pontosIniciais?: PontoLocal[];
  onVoltar: () => void;
  onPlantaAtivaChange?: (plantaId: string) => void;
  onSemPlantas?: () => void;
  onEditarBriefing?: (
    planta: PlantaImportada,
    ambienteInicial?: PosicaoAmbienteInicial,
    pontosAtuais?: PontoLocal[]
  ) => void;
}

export interface PosicaoAmbienteInicial {
  posX: number;
  posY: number;
  nome?: string;
}

export interface PontoLocal {
  id: string;
  plantaId: string;
  simboloId: string;
  posX: number;
  posY: number;
  rotacao: number;
  ambiente?: string;
  /** So visual/local - marca sugestao do motor de regras que pede atencao. Nao e salvo. */
  precisaRevisar?: boolean;
  /** So visual/local - nota do motor de regras (ex: "nos pés da cama"). Nao e salva. */
  observacao?: string;
}

const ESCALA_MIN = 0.2;
const ESCALA_MAX = 8;
const LIMIAR_CLIQUE_PX = 5;
// Evita criar um bitmap gigantesco quando uma planta grande e ampliada fica
// aberta por muito tempo. Dentro desse limite, o canvas acompanha o zoom e
// as letras continuam sendo rasterizadas na resolucao em que serao exibidas.
const MAX_PIXELS_CANVAS_ZOOM = 64_000_000;
const CHAVE_PLANTAS_FECHADAS = "gerador-croqui:plantas-fechadas:v1";

function completarAmbientesDoBriefing(
  ambientesDetectados: AmbienteDetectado[],
  questionario: QuestionarioProjeto,
  plantaId: string
): AmbienteDetectado[] {
  const configurados = (questionario.ambientes ?? []).filter(
    (item) => item.plantaId === plantaId || item.plantaId === undefined
  );
  const manuais = configurados
    .filter(
      (item) =>
        !ambientesDetectados.some(
          (ambiente) => ambiente.nome === item.nome && Math.hypot(ambiente.posX - item.posX, ambiente.posY - item.posY) < 100
        )
    )
    .map((item) => ({
      nome: item.nome,
      areaM2: item.areaM2,
      posX: item.posX,
      posY: item.posY,
      temComputadores: false,
    }));

  return [...ambientesDetectados, ...manuais];
}

function percentualNoCanvas(valor: number, total: number): string {
  return total > 0 ? `${(valor / total) * 100}%` : "0%";
}

function lerIdsPlantasFechadas(projetoId: string): Set<string> {
  try {
    const valor = window.localStorage.getItem(`${CHAVE_PLANTAS_FECHADAS}:${projetoId}`);
    const ids: unknown = valor ? JSON.parse(valor) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function salvarIdsPlantasFechadas(projetoId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(`${CHAVE_PLANTAS_FECHADAS}:${projetoId}`, JSON.stringify([...ids]));
  } catch {
    // O fechamento continua funcionando durante a sessão se o storage estiver bloqueado.
  }
}

export function EditorView({
  projeto,
  plantaInicial,
  pontosIniciais,
  onVoltar,
  onPlantaAtivaChange,
  onSemPlantas,
  onEditarBriefing,
}: Props) {
  const [plantas, setPlantas] = useState<PlantaImportada[]>([plantaInicial]);
  const idsPlantasFechadas = useRef(lerIdsPlantasFechadas(projeto.id));
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
  const [paginaPdf, setPaginaPdf] = useState<PDFPageProxy | null>(null);
  const [ambientesDetectados, setAmbientesDetectados] = useState<AmbienteDetectado[]>([]);
  const [detectandoAmbientes, setDetectandoAmbientes] = useState(false);
  const [mostrarAmbientes, setMostrarAmbientes] = useState(true);
  const [adicionandoAmbiente, setAdicionandoAmbiente] = useState(false);

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
      const abertas = lista.filter((planta) => !idsPlantasFechadas.current.has(planta.id));
      if (abertas.length === 0) {
        setPlantas([]);
        onSemPlantas?.();
        return;
      }

      setPlantas(abertas);
      if (!abertas.some((planta) => planta.id === plantaAtivaId)) {
        setPlantaAtivaId(abertas[0].id);
        onPlantaAtivaChange?.(abertas[0].id);
      }
    });
    buscarQuestionario(projeto.id).then(setQuestionario);
    listarVersoesCroqui(projeto.id).then(async (lista) => {
      setVersoes(lista);
      if (pontosIniciais !== undefined) {
        // Ao voltar do briefing, o rascunho do editor tem prioridade sobre a
        // última versão salva: ela pode ser mais antiga que o que o usuario
        // acabou de posicionar na planta.
        setPontos(pontosIniciais.map((ponto) => ({ ...ponto })));
        setVersaoCarregada(null);
        return;
      }
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
            ambiente: p.ambiente,
          }))
        );
        setVersaoCarregada(ultima.croqui.versao);
      }
    });
  }, [projeto.id, plantaInicial.id, pontosIniciais]);

  // Carrega a pagina ativa. O render em si fica em outro efeito para poder
  // repetir o desenho em uma resolucao maior quando o usuario amplia o zoom.
  useEffect(() => {
    if (plantaAtiva.formatoExibicao !== "pdf") {
      setPaginaPdf(null);
      setCarregandoPdf(false);
      return;
    }

    let cancelado = false;
    setCarregandoPdf(true);
    setErro(null);
    setPaginaPdf(null);
    setTamanhoCanvas({ largura: 0, altura: 0 });
    setTransform({ escala: 1, x: 0, y: 0 });

    (async () => {
      try {
        const documento = await pdfjsLib.getDocument(urlArquivoPlanta(plantaAtiva.id)).promise;
        const pagina = await documento.getPage(1);
        if (cancelado) return;
        const viewport = pagina.getViewport({ scale: calcularEscalaRenderizacao(pagina) });
        setTamanhoCanvas({ largura: viewport.width, altura: viewport.height });
        setPaginaPdf(pagina);
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

  // Renderiza em um canvas temporario e so troca o canvas visivel quando a
  // operacao termina. O canvas visivel mantem sempre o tamanho logico da
  // planta, enquanto o bitmap interno cresce com o zoom/DPI da tela.
  useEffect(() => {
    if (!paginaPdf || tamanhoCanvas.largura <= 0 || tamanhoCanvas.altura <= 0) return;

    let cancelado = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    const zoomAtual = transform.escala;
    const escalaBase = calcularEscalaRenderizacao(paginaPdf);
    const viewportLogico = paginaPdf.getViewport({ scale: escalaBase });
    const pixelsPorCssPixel = Math.max(1, window.devicePixelRatio || 1) * Math.max(1, zoomAtual);
    const fatorPorArea = Math.sqrt(
      MAX_PIXELS_CANVAS_ZOOM / Math.max(1, viewportLogico.width * viewportLogico.height)
    );
    const fatorRenderizacao = Math.max(1, Math.min(pixelsPorCssPixel, fatorPorArea));
    const viewportRender = paginaPdf.getViewport({ scale: escalaBase * fatorRenderizacao });
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Uma pequena espera agrupa varios eventos da roda do mouse em um unico
    // render, evitando renderizar a pagina inteira a cada evento intermediario.
    const timer = window.setTimeout(() => {
      const canvasTemporario = document.createElement("canvas");
      canvasTemporario.width = Math.ceil(viewportRender.width);
      canvasTemporario.height = Math.ceil(viewportRender.height);
      const contextoTemporario = canvasTemporario.getContext("2d");
      if (!contextoTemporario || cancelado) return;

      renderTask = paginaPdf.render({ canvasContext: contextoTemporario, viewport: viewportRender });
      renderTask.promise
        .then(() => {
          if (cancelado || !canvasRef.current) return;
          const canvasVisivel = canvasRef.current;
          canvasVisivel.width = canvasTemporario.width;
          canvasVisivel.height = canvasTemporario.height;
          const contextoVisivel = canvasVisivel.getContext("2d");
          if (!contextoVisivel) return;
          contextoVisivel.drawImage(canvasTemporario, 0, 0);
          setCarregandoPdf(false);
        })
        .catch((err: unknown) => {
          // Cancelar um render anterior durante o zoom e um fluxo normal.
          if (!cancelado && !(err instanceof Error && err.name === "RenderingCancelledException")) {
            setErro(err instanceof Error ? err.message : "Falha ao renderizar o PDF.");
            setCarregandoPdf(false);
          }
        });
    }, zoomAtual === 1 ? 0 : 90);

    return () => {
      cancelado = true;
      window.clearTimeout(timer);
      renderTask?.cancel();
    };
  }, [paginaPdf, tamanhoCanvas.altura, tamanhoCanvas.largura, transform.escala]);

  // Le o texto ja embutido no PDF pra descobrir os ambientes/metragens
  // sozinho (sem IA, sem o usuario digitar nada) - ver lib/detectarAmbientes.
  useEffect(() => {
    if (plantaAtiva.formatoExibicao !== "pdf") {
      setAmbientesDetectados([]);
      setDetectandoAmbientes(false);
      return;
    }
    let cancelado = false;
    setAmbientesDetectados([]);
    setDetectandoAmbientes(true);
    detectarAmbientes(plantaAtiva)
      .then((ambientes) => {
        if (!cancelado) setAmbientesDetectados(ambientes);
      })
      .catch((err: unknown) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Falha ao detectar os ambientes da planta.");
      })
      .finally(() => {
        if (!cancelado) setDetectandoAmbientes(false);
      });
    return () => {
      cancelado = true;
    };
  }, [plantaAtiva]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const fator = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = el.getBoundingClientRect();
      // Ponto sob o cursor, relativo ao centro do wrapper (onde o stage fica
      // centralizado antes de qualquer translate/scale nosso).
      const cursorX = e.clientX - (rect.left + rect.width / 2);
      const cursorY = e.clientY - (rect.top + rect.height / 2);

      setTransform((t) => {
        const novaEscala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, t.escala * fator));
        const razao = novaEscala / t.escala;
        // Mantem o ponto sob o cursor fixo na tela - sem isso, cada scroll
        // reancora no centro do canvas e a planta parece "pular"/deformar
        // ao dar zoom fora do centro.
        return {
          escala: novaEscala,
          x: cursorX - razao * (cursorX - t.x),
          y: cursorY - razao * (cursorY - t.y),
        };
      });
    };
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
    // Guarda o gesto localmente. O updater de setState pode ser executado
    // depois de um pointerup, que limpa arraste.current; ler a ref dentro do
    // updater deixava uma janela para "Cannot read properties of null".
    const gesto = arraste.current;
    if (!gesto) return;
    const dx = e.clientX - gesto.startX;
    const dy = e.clientY - gesto.startY;
    if (Math.abs(dx) > LIMIAR_CLIQUE_PX || Math.abs(dy) > LIMIAR_CLIQUE_PX) {
      cliqueCandidato.current = false;
    }
    setTransform((t) => ({ ...t, x: gesto.origX + dx, y: gesto.origY + dy }));
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    arraste.current = null;
    const foiClique = cliqueCandidato.current;
    cliqueCandidato.current = false;
    if (!foiClique) return;
    if ((e.target as HTMLElement).closest(".ponto-item")) return;

    if (adicionandoAmbiente && stageRef.current && onEditarBriefing) {
      const rect = stageRef.current.getBoundingClientRect();
      const posX = ((e.clientX - rect.left) / rect.width) * tamanhoCanvas.largura;
      const posY = ((e.clientY - rect.top) / rect.height) * tamanhoCanvas.altura;
      const nome = window.prompt("Nome do comodo neste ponto da planta:", "Banheiro")?.trim();
      setAdicionandoAmbiente(false);
      if (nome) onEditarBriefing(plantaAtiva, { nome, posX, posY }, pontos);
      return;
    }

    setSelecionadoId(null);

    if (!simboloAtivo) {
      setMensagem("Selecione um símbolo na paleta (ou arraste ele até aqui) antes de clicar na planta.");
      return;
    }
    adicionarPonto(simboloAtivo.id, e.clientX, e.clientY);
  }

  /** Converte um clique/drop em coordenadas de tela pra coordenadas do canvas e cria o ponto. */
  function adicionarPonto(simboloId: string, clienteX: number, clienteY: number) {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const posX = ((clienteX - rect.left) / rect.width) * tamanhoCanvas.largura;
    const posY = ((clienteY - rect.top) / rect.height) * tamanhoCanvas.altura;
    const ambiente = ambienteMaisProximo(ambientesDetectados, posX, posY)?.nome;

    setPontos((atual) => [
      ...atual,
      { id: crypto.randomUUID(), plantaId: plantaAtivaId, simboloId, posX, posY, rotacao: 0, ambiente },
    ]);
    setMensagem(ambiente ? `Colocado em "${ambiente}".` : null);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes(MIME_SIMBOLO_ID)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    const simboloId = e.dataTransfer.getData(MIME_SIMBOLO_ID);
    if (!simboloId) return;
    e.preventDefault();
    setSelecionadoId(null);
    adicionarPonto(simboloId, e.clientX, e.clientY);
  }

  function removerPonto(id: string) {
    setPontos((atual) => atual.filter((p) => p.id !== id));
    setSelecionadoId((atual) => (atual === id ? null : atual));
  }

  function handleLimparSugestoes() {
    const quantidade = pontosDaPlantaAtiva.length;
    if (quantidade === 0) {
      setMensagem("Esta planta já está limpa.");
      return;
    }

    const confirmou = window.confirm(
      `Limpar ${quantidade} símbolo(s) da planta "${plantaAtiva.nomeArquivoOriginal}"? A planta ficará vazia nesta edição.`
    );
    if (!confirmou) return;

    setPontos((atual) => atual.filter((ponto) => ponto.plantaId !== plantaAtivaId));
    setSelecionadoId(null);
    setSimboloAtivo(null);
    setMensagem("Planta limpa. Todos os símbolos foram removidos da edição atual.");
    setErro(null);
  }

  // ---- sugestao automatica (Fase 6.1 - motor de regras) ----

  function handleAplicarReferencia() {
    if (!questionario) return;
    const ambientes = completarAmbientesDoBriefing(ambientesDetectados, questionario, plantaAtivaId);
    const ambientesComReferencia = ambientes.filter((ambiente) => ambiente.referencia);
    const tiposPorAmbiente = new Map<string, Set<string>>();
    for (const ambiente of ambientesComReferencia) {
      const tipos = new Set<string>();
      if ((ambiente.referencia?.caixas.length ?? 0) > 0) {
        tipos.add("caixa-embutir");
        tipos.add("caixa-embutir-bluetooth");
      }
      if ((ambiente.referencia?.rede.length ?? 0) > 0) tipos.add("ponto-de-rede");
      tiposPorAmbiente.set(ambiente.nome, tipos);
    }
    const sugestoes = sugerirPeloBriefing(ambientes, questionario, plantaAtivaId)
      .filter((sugestao) => tiposPorAmbiente.get(sugestao.ambiente)?.has(sugestao.simboloId));
    const novos: PontoLocal[] = sugestoes.flatMap((sugestao) =>
      calcularPosicoesDaSugestao(sugestao, ambientes).map((posicao) => ({
        id: crypto.randomUUID(), plantaId: plantaAtivaId, simboloId: sugestao.simboloId,
        ambiente: sugestao.ambiente, posX: posicao.x, posY: posicao.y, rotacao: 0,
        observacao: "Posição da referência aprovada para esta planta",
      }))
    );
    const quantidadePendente = sugestoes.reduce((total, sugestao) => total + sugestao.quantidade, 0) - novos.length;
    setPontos((atuais) => [
      ...atuais.filter((ponto) => !(ponto.plantaId === plantaAtivaId &&
        tiposPorAmbiente.get(ponto.ambiente ?? "")?.has(ponto.simboloId))),
      ...novos,
    ]);
    setSelecionadoId(null);
    setMensagem(`Referência aplicada: ${novos.length} símbolo(s) reposicionado(s).` +
      (quantidadePendente > 0 ? ` ${quantidadePendente} item(ns) excedem as posições da referência e precisam de posicionamento manual.` : "") +
      " Salve uma versão para guardar o resultado.");
    setErro(null);
  }

  function handleSugerirAutomaticamente() {
    if (!questionario) {
      setMensagem("Responda o briefing por cômodo antes de gerar o croqui.");
      return;
    }
    const possuiBriefing = (questionario.ambientes?.length ?? 0) > 0;
    if (!possuiBriefing && questionario.servicos.length === 0) {
      setMensagem("Responda o briefing antes de gerar sugestões.");
      return;
    }
    const ambientesParaSugestao = possuiBriefing
      ? completarAmbientesDoBriefing(ambientesDetectados, questionario, plantaAtivaId)
      : ambientesDetectados;
    if (ambientesParaSugestao.length === 0) {
      setMensagem("Nenhum ambiente detectado nesta planta ainda - não dá pra sugerir nada.");
      return;
    }

    setAmbientesDetectados(ambientesParaSugestao);
    const sugestoes = possuiBriefing
      ? sugerirPeloBriefing(ambientesParaSugestao, questionario, plantaAtivaId)
      : [
          ...ambientesDetectados.flatMap((a) => sugerirParaAmbiente(a, questionario.servicos)),
          ...sugerirParaAndar(ambientesDetectados, questionario.servicos),
        ];

    if (sugestoes.length === 0) {
      setMensagem("Nenhuma regra bateu com os ambientes/serviços deste projeto.");
      return;
    }

    const jaSugerido = new Set(
      pontos.filter((p) => p.plantaId === plantaAtivaId).map((p) => `${p.ambiente ?? ""}::${p.simboloId}`)
    );
    const novos: PontoLocal[] = [];
    const pendentes: string[] = [];
    for (const s of sugestoes) {
      const chave = `${s.ambiente}::${s.simboloId}`;
      if (jaSugerido.has(chave)) continue;
      jaSugerido.add(chave);
      const posicoes = calcularPosicoesDaSugestao(s, ambientesParaSugestao);
      if (posicoes.length < s.quantidade) {
        pendentes.push(`${s.ambiente}: ${s.quantidade - posicoes.length} ${s.simboloId === "ponto-de-rede" ? "ponto(s) de rede" : "símbolo(s)"}`);
      }
      for (const pos of posicoes) {
        novos.push({
          id: crypto.randomUUID(),
          plantaId: plantaAtivaId,
          simboloId: s.simboloId,
          posX: pos.x,
          posY: pos.y,
          rotacao: 0,
          ambiente: s.ambiente,
          precisaRevisar: s.revisar,
          observacao: s.observacao,
        });
      }
    }
    setPontos((atual) => [...atual, ...novos]);

    const totalSimbolos = novos.length;
    const qtdRevisar = novos.filter((s) => s.precisaRevisar).length;
    setMensagem(
      `${totalSimbolos} símbolo(s) sugerido(s)` +
        (qtdRevisar > 0 ? ` — ${qtdRevisar} marcado(s) em laranja pra você revisar.` : ".") +
        (pendentes.length > 0
          ? ` Local ainda não identificado (${pendentes.join("; ")}). Posicione esses itens manualmente sobre a mesa, estante ou parede.`
          : " Ajuste posição/quantidade como quiser.")
    );
    setErro(null);
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
        ambiente: p.ambiente,
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
        ambiente: p.ambiente,
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
      onPlantaAtivaChange?.(planta.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao enviar o arquivo.");
    }
  }

  function fecharPlantas(idsParaFechar: Set<string>) {
    const paraFechar = plantas.filter((planta) => idsParaFechar.has(planta.id));
    if (paraFechar.length === 0) return;

    for (const planta of paraFechar) idsPlantasFechadas.current.add(planta.id);
    salvarIdsPlantasFechadas(projeto.id, idsPlantasFechadas.current);
    setPlantas((atual) => atual.filter((planta) => !idsParaFechar.has(planta.id)));

    if (!idsParaFechar.has(plantaAtivaId)) return;

    const proxima = plantas.find((planta) => !idsParaFechar.has(planta.id));
    if (proxima) {
      setPlantaAtivaId(proxima.id);
      onPlantaAtivaChange?.(proxima.id);
    } else {
      onSemPlantas?.();
    }
  }

  function handleFecharPlanta(planta: PlantaImportada) {
    fecharPlantas(new Set([planta.id]));
    setMensagem("Planta fechada.");
  }

  function handleFecharRepetidas() {
    const quantidadePorNome = new Map<string, number>();
    for (const planta of plantas) {
      const nome = planta.nomeArquivoOriginal.trim().toLocaleLowerCase();
      quantidadePorNome.set(nome, (quantidadePorNome.get(nome) ?? 0) + 1);
    }

    const idsParaManter = new Set<string>();
    const nomesMantidos = new Set<string>();
    for (const planta of plantas) {
      const nome = planta.nomeArquivoOriginal.trim().toLocaleLowerCase();
      if ((quantidadePorNome.get(nome) ?? 0) < 2) continue;
      if (planta.id === plantaAtivaId) {
        idsParaManter.add(planta.id);
        nomesMantidos.add(nome);
      }
    }

    const idsParaFechar = new Set<string>();
    for (const planta of plantas) {
      const nome = planta.nomeArquivoOriginal.trim().toLocaleLowerCase();
      if ((quantidadePorNome.get(nome) ?? 0) < 2) continue;
      if (idsParaManter.has(planta.id)) continue;
      if (!nomesMantidos.has(nome)) {
        nomesMantidos.add(nome);
        idsParaManter.add(planta.id);
      } else {
        idsParaFechar.add(planta.id);
      }
    }

    fecharPlantas(idsParaFechar);
    if (idsParaFechar.size > 0) {
      setMensagem(`${idsParaFechar.size} planta(s) repetida(s) fechada(s).`);
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

  const quantidadeRepetidas = useMemo(() => {
    const nomes = new Map<string, number>();
    for (const planta of plantas) {
      const nome = planta.nomeArquivoOriginal.trim().toLocaleLowerCase();
      nomes.set(nome, (nomes.get(nome) ?? 0) + 1);
    }
    return [...nomes.values()].filter((quantidade) => quantidade > 1).length;
  }, [plantas]);

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

        <button
          type="button"
          className="botao-sugerir"
          onClick={handleSugerirAutomaticamente}
          disabled={detectandoAmbientes || carregandoPdf}
        >
          {detectandoAmbientes
            ? "Detectando ambientes…"
            : questionario?.ambientes?.length
              ? "Gerar pelo briefing"
              : "✨ Sugerir automaticamente"}
        </button>
        {ambientesDetectados.some((ambiente) => ambiente.referencia) && (
          <button type="button" onClick={handleAplicarReferencia}
            disabled={detectandoAmbientes || carregandoPdf || !questionario}
            title="Atualiza os itens dos ambientes calibrados desta planta conforme as referências aprovadas">
            Aplicar referências da planta
          </button>
        )}
        {onEditarBriefing && (
          <>
            <button type="button" onClick={() => onEditarBriefing(plantaAtiva, undefined, pontos)}>
              {questionario?.ambientes?.length ? "Editar briefing" : "Configurar briefing"}
            </button>
            <button
              type="button"
              className={adicionandoAmbiente ? "botao-modo-ativo" : ""}
              onClick={() => {
                setAdicionandoAmbiente((atual) => !atual);
                setMensagem(adicionandoAmbiente ? null : "Clique dentro do comodo que falta para cadastra-lo.");
              }}
              disabled={carregandoPdf}
            >
              {adicionandoAmbiente ? "Cancelar cadastro" : "Adicionar comodo na planta"}
            </button>
          </>
        )}
        <button
          type="button"
          className="botao-limpar"
          onClick={handleLimparSugestoes}
          disabled={pontosDaPlantaAtiva.length === 0}
          title="Remover todos os símbolos da planta ativa"
        >
          Limpar sugestões
        </button>
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
        {plantas.map((p) => (
          <div key={p.id} className={`planta-tab planta-tab-container${p.id === plantaAtivaId ? " ativa" : ""}`}>
            <button
              type="button"
              className="planta-tab-selecionar"
              onClick={() => {
                setPlantaAtivaId(p.id);
                onPlantaAtivaChange?.(p.id);
              }}
              title={`Abrir ${p.nomeArquivoOriginal}`}
            >
              {p.nomeArquivoOriginal}
            </button>
            <button
              type="button"
              className="planta-tab-fechar"
              onClick={() => handleFecharPlanta(p)}
              aria-label={`Fechar ${p.nomeArquivoOriginal}`}
              title="Fechar planta"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="planta-tab planta-tab-add" onClick={() => inputPlantaRef.current?.click()}>
          + Planta
        </button>
        {quantidadeRepetidas > 0 && (
          <button type="button" className="planta-tab planta-tab-action" onClick={handleFecharRepetidas}>
            Fechar repetidas
          </button>
        )}
        {ambientesDetectados.length > 0 && (
          <label className="toggle-ambientes">
            <input
              type="checkbox"
              checked={mostrarAmbientes}
              onChange={(e) => setMostrarAmbientes(e.target.checked)}
            />
            {ambientesDetectados.length} ambientes detectados
          </label>
        )}
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
          <p className="dica-editor">Arraste um símbolo até a planta, ou clique nele e depois clique na planta.</p>
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
            onPointerCancel={() => {
              arraste.current = null;
              cliqueCandidato.current = false;
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
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
              {mostrarAmbientes && (
                <div className="ambientes-layer">
                  {ambientesDetectados.map((a, i) => (
                    <div
                      key={`${a.nome}-${i}`}
                      className="ambiente-marcador"
                      style={{
                        left: percentualNoCanvas(a.posX, tamanhoCanvas.largura),
                        top: percentualNoCanvas(a.posY, tamanhoCanvas.altura),
                      }}
                      title={a.areaM2 ? `${a.nome} — ${a.areaM2}m²` : a.nome}
                    >
                      <span className="ambiente-rotulo">{a.nome}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pontos-layer">
                {pontosDaPlantaAtiva.map((p) => {
                  const simbolo = simbolosPorId.get(p.simboloId);
                  if (!simbolo) return null;
                  const selecionado = p.id === selecionadoId;
                  const titulo = [simbolo.nome, p.ambiente, p.observacao].filter(Boolean).join(" — ");
                  return (
                    <div
                      key={p.id}
                      className="ponto-item"
                      style={{
                        left: percentualNoCanvas(p.posX, tamanhoCanvas.largura),
                        top: percentualNoCanvas(p.posY, tamanhoCanvas.altura),
                      }}
                    >
                      <div className="ponto-forma-wrap" style={{ transform: `rotate(${p.rotacao}deg)` }}>
                        <div
                          className={`ponto-marcador ${simbolo.forma}${selecionado ? " selecionado" : ""}${p.precisaRevisar ? " precisa-revisar" : ""}`}
                          style={{ background: simbolo.cor }}
                          title={titulo}
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
