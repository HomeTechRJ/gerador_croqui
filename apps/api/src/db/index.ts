import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.js";

// Banco local do app (SQLite via node:sqlite, sem dependencia nativa externa).
// Standalone: nao tem relacao com o Supabase/ERP da empresa - ver README.
const DATA_DIR = path.resolve(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "croqui.db"));
db.exec("PRAGMA foreign_keys = ON;");
db.exec(SCHEMA_SQL);

/**
 * "CREATE TABLE IF NOT EXISTS" nao adiciona coluna nova a uma tabela que ja
 * existia de um boot anterior - por isso as evolucoes de schema pos-lancamento
 * entram aqui como ALTER TABLE idempotente, em vez de so editar schema.ts.
 */
function ensureColuna(tabela: string, coluna: string, definicaoSql: string): void {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  if (!colunas.some((c) => c.name === coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicaoSql}`);
  }
}

ensureColuna("croqui_pontos", "rotacao", "REAL NOT NULL DEFAULT 0");
ensureColuna("questionarios", "configuracao_json", "TEXT NOT NULL DEFAULT '{}'");

export function agoraISO(): string {
  return new Date().toISOString();
}
