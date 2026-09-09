import { useEffect, useMemo, useState } from "react";
import type {
  ConfiguracaoAmbiente,
  LocalizacaoEquipamento,
  PlantaImportada,
  Projeto,
  ServiceCategory,
  TipoAudioAmbiente,
} from "@croqui/shared";
import { buscarQuestionario, listarPlantasDoProjeto, salvarQuestionario } from "../api";
import { detectarAmbientes } from "../lib/detectarAmbientes";
import type { AmbienteDetectado } from "../lib/detectarAmbientes";

interface Props {
  projeto: Projeto;
  planta: PlantaImportada;
  ambienteInicial?: { posX: number; posY: number; nome?: string };
  onConcluido: () => void;
  onVoltar?: () => void;
}

interface OpcaoAmbiente {
  chave: string;
  plantaId: string;
  nome: string;
  posX: number;
  posY: number;
  rotulo: string;
}

const OPCOES_SERVICOS: { valor: ServiceCategory; rotulo: string }[] = [
  { valor: "rede", rotulo: "Rede" },
  { valor: "audio", rotulo: "Audio" },
  { valor: "video", rotulo: "Video" },
  { valor: "automacao", rotulo: "Automacao" },
  { valor: "seguranca", rotulo: "Seguranca" },
  { valor: "energia", rotulo: "Energia" },
];

const OPCOES_AUDIO: { valor: TipoAudioAmbiente; rotulo: string }[] = [
  { valor: "nenhum", rotulo: "Sem audio" },
  { valor: "receiver", rotulo: "Receiver" },
  { valor: "multiroom", rotulo: "Multiroom" },
  { valor: "bluetooth", rotulo: "Caixas Bluetooth" },
];

function chaveAmbiente(plantaId: string, nome: string, posX: number, posY: number): string {
  return `${plantaId}::${nome}::${Math.round(posX)}::${Math.round(posY)}`;
}

function novaConfiguracao(ambiente: AmbienteDetectado, plantaId: string): ConfiguracaoAmbiente {
  const nome = ambiente.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const ehQuarto = /quarto|dormitorio|suite/.test(nome) && !/closet|banho|banheiro/.test(nome);
  const ehEscritorio = /escritorio|office/.test(nome);
  return {
    plantaId,
    nome: ambiente.nome,
    areaM2: ambiente.areaM2,
    posX: ambiente.posX,
    posY: ambiente.posY,
    caixasSom: ehQuarto ? 2 : 0,
    pontosRede: ehEscritorio ? 3 : 0,
    tipoAudio: "nenhum",
  };
}

function localizarConfiguracaoAnterior(
  ambiente: AmbienteDetectado,
  plantaId: string,
  anteriores: ConfiguracaoAmbiente[] | undefined,
  plantaInicialId: string
): ConfiguracaoAmbiente | undefined {
  return anteriores?.find(
    (item) =>
      (item.plantaId === plantaId || (item.plantaId === undefined && plantaId === plantaInicialId)) &&
      item.nome === ambiente.nome &&
      Math.hypot(item.posX - ambiente.posX, item.posY - ambiente.posY) < 100
  );
}

function localizarOpcaoSalva(local: LocalizacaoEquipamento, opcoes: OpcaoAmbiente[]): LocalizacaoEquipamento | null {
  const opcao = opcoes
    .filter((item) => item.nome === local.ambienteNome && (!local.plantaId || item.plantaId === local.plantaId))
    .sort((a, b) => {
      if (local.posX === undefined || local.posY === undefined) return 0;
      return Math.hypot(a.posX - local.posX, a.posY - local.posY) - Math.hypot(b.posX - local.posX, b.posY - local.posY);
    })[0];
  return opcao
    ? { plantaId: opcao.plantaId, ambienteNome: opcao.nome, posX: opcao.posX, posY: opcao.posY }
    : null;
}

function ajustarLocais(locais: LocalizacaoEquipamento[], quantidade: number, primeiraOpcao?: OpcaoAmbiente): LocalizacaoEquipamento[] {
  return Array.from(
    { length: quantidade },
    (_, indice) => locais[indice] ?? (primeiraOpcao
      ? { plantaId: primeiraOpcao.plantaId, ambienteNome: primeiraOpcao.nome, posX: primeiraOpcao.posX, posY: primeiraOpcao.posY }
      : { ambienteNome: "" })
  );
}

export function QuestionarioView({ projeto, planta, ambienteInicial, onConcluido, onVoltar }: Props) {
  const [plantasCatalogo, setPlantasCatalogo] = useState<PlantaImportada[]>([]);
  const [configuracoes, setConfiguracoes] = useState<ConfiguracaoAmbiente[]>([]);
  const [unifiAps, setUnifiAps] = useState<LocalizacaoEquipamento[]>([]);
  const [quadrosAutomacao, setQuadrosAutomacao] = useState<LocalizacaoEquipamento[]>([]);
  const [servicosSelecionados, setServicosSelecionados] = useState<Set<ServiceCategory>>(new Set());
  const [observacoes, setObservacoes] = useState("");
  const [detectando, setDetectando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novoAmbienteNome, setNovoAmbienteNome] = useState(ambienteInicial?.nome ?? "");
  const [novoAmbientePlantaId, setNovoAmbientePlantaId] = useState(planta.id);
  const [novoAmbientePosX, setNovoAmbientePosX] = useState(ambienteInicial?.posX ?? 0);
  const [novoAmbientePosY, setNovoAmbientePosY] = useState(ambienteInicial?.posY ?? 0);

  useEffect(() => {
    let cancelado = false;
    setDetectando(true);
    setErro(null);

    Promise.all([listarPlantasDoProjeto(projeto.id), buscarQuestionario(projeto.id)])
      .then(async ([plantasDoProjeto, questionario]) => {
        const plantasParaLer = plantasDoProjeto.some((item) => item.id === planta.id)
          ? plantasDoProjeto
          : [planta, ...plantasDoProjeto];
        const prontas = plantasParaLer.filter((item) => item.status === "pronta" && item.formatoExibicao === "pdf");
        const resultados = await Promise.all(
          prontas.map(async (item) => ({ planta: item, ambientes: await detectarAmbientes(item) }))
        );
        if (cancelado) return;

        const novos = resultados.flatMap(({ planta: plantaAtual, ambientes }) =>
          ambientes.map((ambiente) => {
            const anterior = localizarConfiguracaoAnterior(ambiente, plantaAtual.id, questionario?.ambientes, planta.id);
            return anterior
              ? { ...anterior, plantaId: plantaAtual.id, nome: ambiente.nome, areaM2: ambiente.areaM2, posX: ambiente.posX, posY: ambiente.posY }
              : novaConfiguracao(ambiente, plantaAtual.id);
          })
        );
        const opcoes = novos.map((item) => ({
          chave: chaveAmbiente(item.plantaId ?? "", item.nome, item.posX, item.posY),
          plantaId: item.plantaId ?? "",
          nome: item.nome,
          posX: item.posX,
          posY: item.posY,
          rotulo: `${plantasParaLer.find((p) => p.id === item.plantaId)?.nomeArquivoOriginal ?? "Planta"} - ${item.nome}`,
        }));
        const primeiraOpcao = opcoes[0];
        const locaisUnifi = (questionario?.unifiAps ?? [])
          .map((local) => localizarOpcaoSalva(local, opcoes))
          .filter((local): local is LocalizacaoEquipamento => local !== null);
        const locaisQuadros = (questionario?.quadrosAutomacao ?? [])
          .map((local) => localizarOpcaoSalva(local, opcoes))
          .filter((local): local is LocalizacaoEquipamento => local !== null);

        setPlantasCatalogo(plantasParaLer);
        setConfiguracoes(novos);
        const referenciaInicial = novos.find((item) => item.plantaId === planta.id);
        setNovoAmbientePlantaId(planta.id);
        setNovoAmbientePosX(Math.round(ambienteInicial?.posX ?? referenciaInicial?.posX ?? 0));
        setNovoAmbientePosY(Math.round(ambienteInicial?.posY ?? referenciaInicial?.posY ?? 0));
        if (ambienteInicial?.nome) setNovoAmbienteNome(ambienteInicial.nome);
        setUnifiAps(ajustarLocais(locaisUnifi, locaisUnifi.length, primeiraOpcao));
        setQuadrosAutomacao(ajustarLocais(locaisQuadros, locaisQuadros.length, primeiraOpcao));
        setServicosSelecionados(new Set(questionario?.servicos ?? []));
        setObservacoes(questionario?.observacoes ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Nao foi possivel identificar os comodos.");
      })
      .finally(() => {
        if (!cancelado) setDetectando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [ambienteInicial, planta, projeto.id]);

  const opcoesAmbientes = useMemo<OpcaoAmbiente[]>(
    () => configuracoes.map((item) => ({
      chave: chaveAmbiente(item.plantaId ?? "", item.nome, item.posX, item.posY),
      plantaId: item.plantaId ?? "",
      nome: item.nome,
      posX: item.posX,
      posY: item.posY,
      rotulo: `${plantasCatalogo.find((p) => p.id === item.plantaId)?.nomeArquivoOriginal ?? "Planta"} - ${item.nome}`,
    })),
    [configuracoes, plantasCatalogo]
  );

  const totais = useMemo(
    () => ({
      caixas: configuracoes.reduce((total, ambiente) => total + ambiente.caixasSom, 0),
      rede: configuracoes.reduce((total, ambiente) => total + ambiente.pontosRede, 0),
    }),
    [configuracoes]
  );

  function atualizarAmbiente(indice: number, mudanca: Partial<ConfiguracaoAmbiente>) {
    setConfiguracoes((atuais) => atuais.map((ambiente, i) => (i === indice ? { ...ambiente, ...mudanca } : ambiente)));
  }

  function atualizarQuantidade(valor: string, limite: number, atualizar: (quantidade: number) => void) {
    atualizar(Math.max(0, Math.min(limite, Number.parseInt(valor, 10) || 0)));
  }

  function alternarServico(servico: ServiceCategory) {
    setServicosSelecionados((atuais) => {
      const novo = new Set(atuais);
      if (novo.has(servico)) novo.delete(servico);
      else novo.add(servico);
      return novo;
    });
  }

  function prepararPosicaoDoNovoAmbiente(plantaId: string) {
    const referencia = configuracoes.find((item) => item.plantaId === plantaId);
    setNovoAmbientePlantaId(plantaId);
    setNovoAmbientePosX(Math.round(referencia?.posX ?? 0));
    setNovoAmbientePosY(Math.round(referencia?.posY ?? 0));
  }

  function adicionarAmbienteManual() {
    const nome = novoAmbienteNome.trim();
    if (!nome) {
      setErro("Informe o nome do comodo que falta na planta.");
      return;
    }
    if (configuracoes.some((item) => item.plantaId === novoAmbientePlantaId && item.nome.toLowerCase() === nome.toLowerCase())) {
      setErro("Esse comodo ja esta cadastrado nesta planta.");
      return;
    }

    setConfiguracoes((atuais) => [
      ...atuais,
      {
        plantaId: novoAmbientePlantaId,
        nome,
        areaM2: null,
        posX: novoAmbientePosX,
        posY: novoAmbientePosY,
        manual: true,
        caixasSom: 0,
        pontosRede: 0,
        tipoAudio: "nenhum",
      },
    ]);
    setNovoAmbienteNome("");
    setErro(null);
  }

  function localParaChave(local: LocalizacaoEquipamento): string {
    const opcao = opcoesAmbientes
      .filter((item) => item.nome === local.ambienteNome && (!local.plantaId || item.plantaId === local.plantaId))
      .sort((a, b) => {
        if (local.posX === undefined || local.posY === undefined) return 0;
        return Math.hypot(a.posX - local.posX, a.posY - local.posY) - Math.hypot(b.posX - local.posX, b.posY - local.posY);
      })[0];
    return opcao?.chave ?? "";
  }

  function selecionarLocal(chave: string): LocalizacaoEquipamento | null {
    const opcao = opcoesAmbientes.find((item) => item.chave === chave);
    return opcao ? { plantaId: opcao.plantaId, ambienteNome: opcao.nome, posX: opcao.posX, posY: opcao.posY } : null;
  }

  async function handleSalvar() {
    setErro(null);
    if (configuracoes.length === 0) {
      setErro("Nenhum nome de comodo foi identificado nesta planta. Cadastre pelo menos um comodo manualmente para continuar.");
      return;
    }
    if (servicosSelecionados.size === 0) {
      setErro("Selecione pelo menos um servico do projeto antes de continuar.");
      return;
    }
    setSalvando(true);
    try {
      await salvarQuestionario(projeto.id, {
        servicos: [...servicosSelecionados],
        observacoes,
        ambientes: configuracoes,
        unifiAps,
        quadrosAutomacao,
      });
      setSalvo(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado ao salvar o briefing.");
    } finally {
      setSalvando(false);
    }
  }

  if (salvo) {
    return (
      <div className="upload-view">
        <header className="upload-header">
          <p className="eyebrow">{projeto.nomeCliente}</p>
          <h1>Briefing salvo</h1>
          <p className="subtitulo">O croqui sera gerado somente com as decisoes que voce informou.</p>
        </header>
        <div className="briefing-resumo">
          <p><strong>{configuracoes.length}</strong> comodo(s) configurado(s) em <strong>{plantasCatalogo.length}</strong> planta(s)</p>
          <p><strong>{totais.caixas}</strong> caixa(s) de som - <strong>{totais.rede}</strong> ponto(s) de rede</p>
          <p><strong>{unifiAps.length}</strong> UniFi AP - <strong>{quadrosAutomacao.length}</strong> quadro(s) de automacao</p>
        </div>
        <button type="button" onClick={onConcluido}>Abrir planta -&gt;</button>
      </div>
    );
  }

  return (
    <div className="upload-view briefing-view">
      <header className="upload-header">
        {onVoltar && <button type="button" onClick={onVoltar}>Voltar para a planta</button>}
        <p className="eyebrow">{projeto.nomeCliente}</p>
        <h1>Vamos definir o croqui</h1>
        <p className="subtitulo">Primeiro perguntamos o que o projeto contempla e depois configuramos cada comodo.</p>
      </header>

      <section className="briefing-secao">
        <h2>1. O que este projeto contempla?</h2>
        <p className="briefing-ajuda">Selecione os servicos contratados. Isso controla as perguntas e os simbolos usados.</p>
        <div className="briefing-servicos">
          {OPCOES_SERVICOS.map((opcao) => (
            <label key={opcao.valor} className={`opcao-servico${servicosSelecionados.has(opcao.valor) ? " marcada" : ""}`}>
              <input type="checkbox" checked={servicosSelecionados.has(opcao.valor)} onChange={() => alternarServico(opcao.valor)} />
              {opcao.rotulo}
            </label>
          ))}
        </div>
      </section>

      {detectando ? <p className="subtitulo">Identificando comodos nas plantas...</p> : (
        <>
          {configuracoes.length === 0 && <p className="erro" role="alert">Nenhum nome de comodo foi identificado. Esta prancha pode conter apenas pontos eletricos, sem rotulos de ambientes. Cadastre os comodos manualmente abaixo ou envie a planta arquitetonica com os nomes.</p>}

          <section className="briefing-secao briefing-manual">
            <h2>Adicionar comodo que nao foi encontrado</h2>
            <p className="briefing-ajuda">Exemplo: cadastre o banheiro manualmente. Informe tambem a posicao aproximada no croqui para as sugestoes nascerem dentro dele; depois voce pode ajustar os simbolos na planta.</p>
            <div className="briefing-manual-campos">
              <label>Nome do comodo
                <input type="text" value={novoAmbienteNome} placeholder="Ex.: Banheiro" onChange={(e) => setNovoAmbienteNome(e.target.value)} />
              </label>
              <label>Planta
                <select value={novoAmbientePlantaId} onChange={(e) => prepararPosicaoDoNovoAmbiente(e.target.value)}>
                  {plantasCatalogo.map((item) => <option key={item.id} value={item.id}>{item.nomeArquivoOriginal}</option>)}
                </select>
              </label>
              <label>Posicao X
                <input type="number" value={novoAmbientePosX} onChange={(e) => setNovoAmbientePosX(Number(e.target.value) || 0)} />
              </label>
              <label>Posicao Y
                <input type="number" value={novoAmbientePosY} onChange={(e) => setNovoAmbientePosY(Number(e.target.value) || 0)} />
              </label>
              <button type="button" onClick={adicionarAmbienteManual}>Adicionar comodo</button>
            </div>
          </section>

          <section className="briefing-secao">
            <h2>2. Equipamentos por comodo</h2>
            <p className="briefing-ajuda">Zero significa que nao devemos inserir aquele item automaticamente.</p>
            <div className="briefing-ambientes">
              {configuracoes.map((ambiente, indice) => (
                <article key={`${ambiente.plantaId}-${ambiente.nome}-${ambiente.posX}-${ambiente.posY}`} className="briefing-ambiente">
                  <div className="briefing-ambiente-titulo">
                    <strong>{ambiente.nome}</strong>
                    <span>{ambiente.manual ? "Adicionado manualmente" : plantasCatalogo.find((item) => item.id === ambiente.plantaId)?.nomeArquivoOriginal ?? "Planta"}</span>
                  </div>
                  {servicosSelecionados.has("audio") && (
                    <>
                      <label>Caixas de som
                        <input type="number" min="0" max="20" value={ambiente.caixasSom} onChange={(e) => atualizarQuantidade(e.target.value, 20, (quantidade) => atualizarAmbiente(indice, { caixasSom: quantidade }))} />
                      </label>
                      <label>Sistema de audio
                        <select value={ambiente.tipoAudio} onChange={(e) => atualizarAmbiente(indice, { tipoAudio: e.target.value as TipoAudioAmbiente })}>
                          {OPCOES_AUDIO.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  {servicosSelecionados.has("rede") && (
                    <>
                      <label>Pontos de rede
                        <input type="number" min="0" max="20" value={ambiente.pontosRede} onChange={(e) => atualizarQuantidade(e.target.value, 20, (quantidade) => atualizarAmbiente(indice, { pontosRede: quantidade }))} />
                      </label>
                      {/escritorio|office/i.test(ambiente.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) && (
                        <span className="briefing-ajuda">Escritório: 3 pontos — um para cada computador e um para possível impressora.</span>
                      )}
                    </>
                  )}
                  {!servicosSelecionados.has("audio") && !servicosSelecionados.has("rede") && <span className="briefing-ajuda">Selecione Audio ou Rede para configurar este comodo.</span>}
                </article>
              ))}
            </div>
          </section>

          {servicosSelecionados.has("rede") && (
            <section className="briefing-secao briefing-globais">
              <h2>3. UniFi AP</h2>
              <label>Quantidade de UniFi AP
                <input type="number" min="0" max="10" value={unifiAps.length} onChange={(e) => atualizarQuantidade(e.target.value, 10, (quantidade) => setUnifiAps((atuais) => ajustarLocais(atuais, quantidade, opcoesAmbientes[0])))} />
              </label>
              {unifiAps.map((local, indice) => (
                <label key={`unifi-${indice}`}>Local do UniFi AP {indice + 1}
                  <select value={localParaChave(local)} onChange={(e) => setUnifiAps((atuais) => atuais.map((item, i) => i === indice ? (selecionarLocal(e.target.value) ?? item) : item))}>
                    {opcoesAmbientes.map((opcao) => <option key={opcao.chave} value={opcao.chave}>{opcao.rotulo}</option>)}
                  </select>
                </label>
              ))}
            </section>
          )}

          {servicosSelecionados.has("automacao") && (
            <section className="briefing-secao briefing-globais">
              <h2>4. Quadros de automacao</h2>
              <label>Quantidade de quadros
                <input type="number" min="0" max="10" value={quadrosAutomacao.length} onChange={(e) => atualizarQuantidade(e.target.value, 10, (quantidade) => setQuadrosAutomacao((atuais) => ajustarLocais(atuais, quantidade, opcoesAmbientes[0])))} />
              </label>
              {quadrosAutomacao.map((local, indice) => (
                <label key={`quadro-${indice}`}>Local do quadro {indice + 1}
                  <select value={localParaChave(local)} onChange={(e) => setQuadrosAutomacao((atuais) => atuais.map((item, i) => i === indice ? (selecionarLocal(e.target.value) ?? item) : item))}>
                    {opcoesAmbientes.map((opcao) => <option key={opcao.chave} value={opcao.chave}>{opcao.rotulo}</option>)}
                  </select>
                </label>
              ))}
            </section>
          )}

          <textarea className="observacoes-textarea" placeholder="Observacoes gerais do cliente (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} />
          <button type="button" onClick={handleSalvar} disabled={salvando || detectando || configuracoes.length === 0 || servicosSelecionados.size === 0}>
            {salvando ? "Salvando briefing..." : "Salvar briefing e continuar"}
          </button>
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  );
}
