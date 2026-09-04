import { randomUUID } from "node:crypto";
import type { Croqui, CroquiPonto, NovoCroquiPonto } from "@croqui/shared";
import { agoraISO, db } from "./index.js";

function linhaParaCroqui(l: Record<string, unknown>): Croqui {
  return {
    id: l.id as string,
    projetoId: l.projeto_id as string,
    versao: l.versao as number,
    observacoes: (l.observacoes as string | null) ?? undefined,
    criadoEm: l.criado_em as string,
  };
}

function linhaParaPonto(l: Record<string, unknown>): CroquiPonto {
  return {
    id: l.id as string,
    croquiId: l.croqui_id as string,
    plantaId: (l.planta_id as string | null) ?? undefined,
    simboloId: l.simbolo_id as string,
    ambiente: (l.ambiente as string | null) ?? undefined,
    posX: l.pos_x as number,
    posY: l.pos_y as number,
    rotacao: l.rotacao as number,
    criadoEm: l.criado_em as string,
  };
}

/**
 * Cria uma nova versao do croqui do projeto (nunca sobrescreve uma versao
 * existente) com o conjunto de pontos dado. E assim que o versionamento
 * funciona: cada "salvar" fica registrado pra sempre, dá pra comparar/voltar.
 */
export function criarVersaoCroqui(
  projetoId: string,
  pontos: NovoCroquiPonto[],
  observacoes?: string
): Croqui {
  const ultima = db
    .prepare("SELECT MAX(versao) as max_versao FROM croquis WHERE projeto_id = ?")
    .get(projetoId) as { max_versao: number | null };
  const proximaVersao = (ultima.max_versao ?? 0) + 1;

  const croqui: Croqui = {
    id: randomUUID(),
    projetoId,
    versao: proximaVersao,
    observacoes,
    criadoEm: agoraISO(),
  };

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO croquis (id, projeto_id, versao, observacoes, criado_em) VALUES (?, ?, ?, ?, ?)"
    ).run(croqui.id, croqui.projetoId, croqui.versao, croqui.observacoes ?? null, croqui.criadoEm);

    const inserirPonto = db.prepare(
      `INSERT INTO croqui_pontos (id, croqui_id, planta_id, simbolo_id, ambiente, pos_x, pos_y, rotacao, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of pontos) {
      inserirPonto.run(
        randomUUID(),
        croqui.id,
        p.plantaId ?? null,
        p.simboloId,
        p.ambiente ?? null,
        p.posX,
        p.posY,
        p.rotacao ?? 0,
        agoraISO()
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return croqui;
}

export function listarVersoesCroqui(projetoId: string): Croqui[] {
  const linhas = db
    .prepare("SELECT * FROM croquis WHERE projeto_id = ? ORDER BY versao DESC")
    .all(projetoId);
  return linhas.map((l) => linhaParaCroqui(l as Record<string, unknown>));
}

export function buscarCroquiComPontos(
  croquiId: string
): { croqui: Croqui; pontos: CroquiPonto[] } | undefined {
  const linha = db.prepare("SELECT * FROM croquis WHERE id = ?").get(croquiId);
  if (!linha) return undefined;

  const pontos = db
    .prepare("SELECT * FROM croqui_pontos WHERE croqui_id = ? ORDER BY criado_em ASC")
    .all(croquiId);

  return {
    croqui: linhaParaCroqui(linha as Record<string, unknown>),
    pontos: pontos.map((p) => linhaParaPonto(p as Record<string, unknown>)),
  };
}
