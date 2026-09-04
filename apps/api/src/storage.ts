import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { FormatoPlanta } from "@croqui/shared";

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
export const PROCESSED_DIR = path.resolve(process.cwd(), "processed");

export async function ensureDirs(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
}

const FORMATOS_SUPORTADOS: FormatoPlanta[] = ["pdf", "dwg", "dxf"];

/** Deduz o formato pela extensao do nome do arquivo enviado. */
export function extensaoParaFormato(nomeArquivo: string): FormatoPlanta | null {
  const ext = path.extname(nomeArquivo).toLowerCase().replace(".", "");
  return (FORMATOS_SUPORTADOS as string[]).includes(ext) ? (ext as FormatoPlanta) : null;
}
