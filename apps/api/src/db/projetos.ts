import { randomUUID } from "node:crypto";
import type { Projeto } from "@croqui/shared";
import { agoraISO, db } from "./index.js";

export function criarProjeto(nomeCliente: string): Projeto {
  const projeto: Projeto = {
    id: randomUUID(),
    nomeCliente,
    criadoEm: agoraISO(),
    atualizadoEm: agoraISO(),
  };
  db.prepare(
    "INSERT INTO projetos (id, nome_cliente, criado_em, atualizado_em) VALUES (?, ?, ?, ?)"
  ).run(projeto.id, projeto.nomeCliente, projeto.criadoEm, projeto.atualizadoEm);
  return projeto;
}

function linhaParaProjeto(linha: Record<string, unknown>): Projeto {
  return {
    id: linha.id as string,
    nomeCliente: linha.nome_cliente as string,
    criadoEm: linha.criado_em as string,
    atualizadoEm: linha.atualizado_em as string,
  };
}

export function listarProjetos(): Projeto[] {
  const linhas = db.prepare("SELECT * FROM projetos ORDER BY atualizado_em DESC").all();
  return linhas.map((l) => linhaParaProjeto(l as Record<string, unknown>));
}

export function buscarProjeto(id: string): Projeto | undefined {
  const linha = db.prepare("SELECT * FROM projetos WHERE id = ?").get(id);
  return linha ? linhaParaProjeto(linha as Record<string, unknown>) : undefined;
}
