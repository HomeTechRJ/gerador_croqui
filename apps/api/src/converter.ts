import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { PROCESSED_DIR } from "./storage.js";

/**
 * Converte um DWG para DXF usando o ODA File Converter, rodando self-hosted
 * no servidor da API (gratuito, sem custo por arquivo).
 *
 * Requer o executavel instalado nesta maquina e o caminho configurado em
 * ODA_CONVERTER_PATH (.env da API). Download oficial:
 * https://www.opendesign.com/guestfiles/oda_file_converter
 *
 * O ODA File Converter opera em pastas (nao em um unico arquivo), entao
 * criamos uma pasta de entrada/saida temporaria so pra este DWG.
 */
export async function converterDwgParaDxf(dwgPath: string, plantaId: string): Promise<string> {
  const converterPath = process.env.ODA_CONVERTER_PATH;
  if (!converterPath) {
    throw new Error(
      "Conversor de DWG nao configurado no servidor. Instale o ODA File Converter e " +
        "defina ODA_CONVERTER_PATH no .env da API (veja apps/api/.env.example)."
    );
  }

  const tmpRoot = path.join(PROCESSED_DIR, "_tmp");
  const inputDir = path.join(tmpRoot, `${plantaId}-in`);
  const outputDir = path.join(tmpRoot, `${plantaId}-out`);
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  try {
    await copyFile(dwgPath, path.join(inputDir, path.basename(dwgPath)));

    // Args do ODA File Converter: <pastaEntrada> <pastaSaida> <versaoSaida> <tipoSaida> <recursivo> <auditar>
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(converterPath, [inputDir, outputDir, "ACAD2018", "DXF", "0", "1"], {
        windowsHide: true,
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ODA File Converter terminou com codigo ${code}.`));
      });
    });

    const arquivosGerados = await readdir(outputDir);
    const dxfGerado = arquivosGerados.find((f) => f.toLowerCase().endsWith(".dxf"));
    if (!dxfGerado) {
      throw new Error("A conversao rodou mas nenhum .dxf foi encontrado na saida.");
    }

    const destino = path.join(PROCESSED_DIR, `${plantaId}.dxf`);
    await rename(path.join(outputDir, dxfGerado), destino);
    return destino;
  } finally {
    await rm(inputDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
}
