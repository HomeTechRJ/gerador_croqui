import Fastify from "fastify";
import type { Projeto } from "@croqui/shared";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

// Placeholder da Fase 1: endpoint que vai receber o upload da planta
// (PDF/DXF/DWG) e disparar a conversao via ODA File Converter quando for DWG.
app.get("/projetos", async (): Promise<Projeto[]> => {
  return [];
});

const port = Number(process.env.PORT ?? 3333);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
