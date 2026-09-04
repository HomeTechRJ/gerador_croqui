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

export function agoraISO(): string {
  return new Date().toISOString();
}
