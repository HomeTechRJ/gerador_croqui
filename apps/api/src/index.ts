import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type {
  NovoCroquiPonto,
  PlantaImportada,
  QuestionarioProjeto,
  ServiceCategory,
} from "@croqui/shared";
import { converterDwgParaDxf } from "./converter.js";
import { agoraISO } from "./db/index.js";
import { buscarPlanta, listarPlantasPorProjeto, salvarPlanta } from "./db/plantas.js";
import { buscarProjeto, criarProjeto, listarProjetos } from "./db/projetos.js";
import { buscarQuestionario, salvarQuestionario } from "./db/questionarios.js";
import { buscarCroquiComPontos, criarVersaoCroqui, listarVersoesCroqui } from "./db/croquis.js";
import { ensureDirs, extensaoParaFormato, PROCESSED_DIR, UPLOADS_DIR } from "./storage.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

await ensureDirs();

app.get("/health", async () => ({ status: "ok" }));

// ---- Projetos ----

app.post("/projetos", async (request, reply) => {
  const body = request.body as { nomeCliente?: string } | undefined;
  const nomeCliente = body?.nomeCliente?.trim();
  if (!nomeCliente) {
    return reply.code(400).send({ erro: "Informe o nome do cliente." });
  }
  return criarProjeto(nomeCliente);
});

app.get("/projetos", async () => listarProjetos());

app.get("/projetos/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const projeto = buscarProjeto(id);
  if (!projeto) return reply.code(404).send({ erro: "Projeto nao encontrado." });
  return projeto;
});

// ---- Plantas (Fase 1) ----

app.post("/plantas", async (request, reply) => {
  const arquivo = await request.file();
  if (!arquivo) {
    return reply.code(400).send({ erro: "Nenhum arquivo enviado (campo 'arquivo')." });
  }

  const projetoId = (arquivo.fields.projetoId as { value?: string } | undefined)?.value;
  if (!projetoId || !buscarProjeto(projetoId)) {
    return reply.code(400).send({ erro: "Informe um projetoId valido (campo 'projetoId')." });
  }

  const formato = extensaoParaFormato(arquivo.filename);
  if (!formato) {
    return reply.code(400).send({ erro: "Formato nao suportado. Envie .pdf, .dxf ou .dwg." });
  }

  const plantaId = randomUUID();
  const caminhoOriginal = path.join(UPLOADS_DIR, `${plantaId}.${formato}`);
  await pipeline(arquivo.file, createWriteStream(caminhoOriginal));

  let planta: PlantaImportada = {
    id: plantaId,
    projetoId,
    formatoOriginal: formato,
    status: "pronta",
    nomeArquivoOriginal: arquivo.filename,
    criadoEm: agoraISO(),
  };

  if (formato === "dwg") {
    planta.status = "convertendo";
    try {
      await converterDwgParaDxf(caminhoOriginal, plantaId);
      planta = { ...planta, status: "pronta", formatoExibicao: "dxf" };
    } catch (err) {
      planta = {
        ...planta,
        status: "erro_conversao",
        mensagemErro: err instanceof Error ? err.message : "Falha na conversao do DWG.",
      };
    }
  } else {
    await copyFile(caminhoOriginal, path.join(PROCESSED_DIR, `${plantaId}.${formato}`));
    planta.formatoExibicao = formato;
  }

  salvarPlanta(planta);
  return planta;
});

app.get("/plantas/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const planta = buscarPlanta(id);
  if (!planta) return reply.code(404).send({ erro: "Planta nao encontrada." });
  return planta;
});

app.get("/projetos/:id/plantas", async (request) => {
  const { id } = request.params as { id: string };
  return listarPlantasPorProjeto(id);
});

app.get("/plantas/:id/arquivo", async (request, reply) => {
  const { id } = request.params as { id: string };
  const planta = buscarPlanta(id);
  if (!planta || planta.status !== "pronta" || !planta.formatoExibicao) {
    return reply.code(404).send({ erro: "Arquivo ainda nao disponivel para visualizacao." });
  }
  const caminho = path.join(PROCESSED_DIR, `${id}.${planta.formatoExibicao}`);
  reply.header(
    "Content-Type",
    planta.formatoExibicao === "pdf" ? "application/pdf" : "application/dxf"
  );
  return reply.send(createReadStream(caminho));
});

// ---- Questionario (Fase 2) ----

app.put("/projetos/:id/questionario", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!buscarProjeto(id)) return reply.code(404).send({ erro: "Projeto nao encontrado." });

  const body = request.body as { servicos?: ServiceCategory[]; observacoes?: string };
  if (!Array.isArray(body.servicos)) {
    return reply.code(400).send({ erro: "Informe 'servicos' como lista." });
  }

  const questionario: QuestionarioProjeto = {
    projetoId: id,
    servicos: body.servicos,
    observacoes: body.observacoes,
  };
  return salvarQuestionario(questionario);
});

app.get("/projetos/:id/questionario", async (request, reply) => {
  const { id } = request.params as { id: string };
  const questionario = buscarQuestionario(id);
  if (!questionario) return reply.code(404).send({ erro: "Questionario ainda nao respondido." });
  return questionario;
});

// ---- Croquis e versionamento (base pronta pra Fase 4, o editor) ----

app.post("/projetos/:id/croquis", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!buscarProjeto(id)) return reply.code(404).send({ erro: "Projeto nao encontrado." });

  const body = request.body as { pontos?: NovoCroquiPonto[]; observacoes?: string };
  const pontos = body.pontos ?? [];
  return criarVersaoCroqui(id, pontos, body.observacoes);
});

app.get("/projetos/:id/croquis", async (request) => {
  const { id } = request.params as { id: string };
  return listarVersoesCroqui(id);
});

app.get("/croquis/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const resultado = buscarCroquiComPontos(id);
  if (!resultado) return reply.code(404).send({ erro: "Croqui nao encontrado." });
  return resultado;
});

const port = Number(process.env.PORT ?? 3333);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
