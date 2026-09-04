import type { PlantaImportada } from "@croqui/shared";
import { db } from "./index.js";

function linhaParaPlanta(l: Record<string, unknown>): PlantaImportada {
  return {
    id: l.id as string,
    projetoId: l.projeto_id as string,
    formatoOriginal: l.formato_original as PlantaImportada["formatoOriginal"],
    status: l.status as PlantaImportada["status"],
    nomeArquivoOriginal: l.nome_arquivo_original as string,
    formatoExibicao: (l.formato_exibicao as PlantaImportada["formatoExibicao"]) ?? undefined,
    mensagemErro: (l.mensagem_erro as string | null) ?? undefined,
    criadoEm: l.criado_em as string,
  };
}

export function salvarPlanta(planta: PlantaImportada): void {
  db.prepare(
    `INSERT INTO plantas (id, projeto_id, formato_original, status, nome_arquivo_original, formato_exibicao, mensagem_erro, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       formato_exibicao = excluded.formato_exibicao,
       mensagem_erro = excluded.mensagem_erro`
  ).run(
    planta.id,
    planta.projetoId,
    planta.formatoOriginal,
    planta.status,
    planta.nomeArquivoOriginal,
    planta.formatoExibicao ?? null,
    planta.mensagemErro ?? null,
    planta.criadoEm
  );
}

export function buscarPlanta(id: string): PlantaImportada | undefined {
  const linha = db.prepare("SELECT * FROM plantas WHERE id = ?").get(id);
  return linha ? linhaParaPlanta(linha as Record<string, unknown>) : undefined;
}

export function listarPlantasPorProjeto(projetoId: string): PlantaImportada[] {
  const linhas = db
    .prepare("SELECT * FROM plantas WHERE projeto_id = ? ORDER BY criado_em ASC")
    .all(projetoId);
  return linhas.map((l) => linhaParaPlanta(l as Record<string, unknown>));
}
