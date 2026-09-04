import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlantaImportada } from "@croqui/shared";

// Persistencia simples em arquivo JSON. Serve pro MVP da Fase 1; entra
// PostgreSQL de verdade quando o questionario (Fase 2) precisar de dados
// relacionais (projeto -> respostas -> plantas).
const DB_FILE = path.resolve(process.cwd(), "plantas.json");

let plantas = new Map<string, PlantaImportada>();

export async function carregarPlantas(): Promise<void> {
  try {
    const raw = await readFile(DB_FILE, "utf-8");
    const lista: PlantaImportada[] = JSON.parse(raw);
    plantas = new Map(lista.map((p) => [p.id, p]));
  } catch {
    plantas = new Map();
  }
}

async function persistir(): Promise<void> {
  await writeFile(DB_FILE, JSON.stringify([...plantas.values()], null, 2), "utf-8");
}

export async function salvarPlanta(planta: PlantaImportada): Promise<void> {
  plantas.set(planta.id, planta);
  await persistir();
}

export function buscarPlanta(id: string): PlantaImportada | undefined {
  return plantas.get(id);
}
