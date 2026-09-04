import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type { PlantaImportada } from "@croqui/shared";
import { converterDwgParaDxf } from "./converter.js";
import { buscarPlanta, carregarPlantas, salvarPlanta } from "./plantas-store.js";
import { ensureDirs, extensaoParaFormato, PROCESSED_DIR, UPLOADS_DIR } from "./storage.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

await ensureDirs();
await carregarPlantas();

app.get("/health", async () => ({ status: "ok" }));

// Fase 1: recebe a planta do cliente (PDF/DXF direto, ou DWG + conversao).
app.post("/plantas", async (request, reply) => {
  const arquivo = await request.file();
  if (!arquivo) {
    return reply.code(400).send({ erro: "Nenhum arquivo enviado (campo 'arquivo')." });
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
    projetoId: "default", // Fase 2 associa a um projeto/cliente de verdade
    formatoOriginal: formato,
    status: "pronta",
    nomeArquivoOriginal: arquivo.filename,
    criadoEm: new Date().toISOString(),
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

  await salvarPlanta(planta);
  return planta;
});

app.get("/plantas/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const planta = buscarPlanta(id);
  if (!planta) return reply.code(404).send({ erro: "Planta nao encontrada." });
  return planta;
});

// Serve o arquivo ja pronto pra visualizacao (pdf ou dxf).
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

const port = Number(process.env.PORT ?? 3333);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
