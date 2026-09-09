import type { QuestionarioProjeto, ServiceCategory } from "@croqui/shared";
import { agoraISO, db } from "./index.js";

function linhaParaQuestionario(l: Record<string, unknown>): QuestionarioProjeto {
  const configuracao = JSON.parse((l.configuracao_json as string | null) ?? "{}");
  return {
    projetoId: l.projeto_id as string,
    servicos: JSON.parse(l.servicos as string) as ServiceCategory[],
    observacoes: (l.observacoes as string | null) ?? undefined,
    ambientes: configuracao.ambientes,
    unifiAps: configuracao.unifiAps,
    quadrosAutomacao: configuracao.quadrosAutomacao,
  };
}

export function salvarQuestionario(q: QuestionarioProjeto): QuestionarioProjeto {
  db.prepare(
    `INSERT INTO questionarios (projeto_id, servicos, observacoes, configuracao_json, atualizado_em)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(projeto_id) DO UPDATE SET
       servicos = excluded.servicos,
       observacoes = excluded.observacoes,
       configuracao_json = excluded.configuracao_json,
       atualizado_em = excluded.atualizado_em`
  ).run(
    q.projetoId,
    JSON.stringify(q.servicos),
    q.observacoes ?? null,
    JSON.stringify({
      ambientes: q.ambientes ?? [],
      unifiAps: q.unifiAps ?? [],
      quadrosAutomacao: q.quadrosAutomacao ?? [],
    }),
    agoraISO()
  );
  return q;
}

export function buscarQuestionario(projetoId: string): QuestionarioProjeto | undefined {
  const linha = db.prepare("SELECT * FROM questionarios WHERE projeto_id = ?").get(projetoId);
  return linha ? linhaParaQuestionario(linha as Record<string, unknown>) : undefined;
}
