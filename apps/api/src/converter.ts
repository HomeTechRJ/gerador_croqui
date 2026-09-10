import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PROCESSED_DIR } from "./storage.js";

const TEMPO_LIMITE_CONVERSAO_MS = 3 * 60 * 1000;
const VERSAO_SAIDA_PADRAO = "ACAD2018";

function normalizarCaminhoConfigurado(valor: string | undefined): string | undefined {
  const caminho = valor?.trim();
  if (!caminho) return undefined;
  return caminho.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_completo, aspasDuplas, aspasSimples) => {
    return aspasDuplas ?? aspasSimples;
  });
}

async function eArquivo(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}

async function localizarOdaFileConverter(): Promise<string> {
  const configurado = normalizarCaminhoConfigurado(process.env.ODA_CONVERTER_PATH);
  const candidatos = new Set<string>();
  if (configurado) candidatos.add(configurado);

  // O instalador por usuario e o instalador para todos os usuarios usam
  // pastas diferentes. A busca automatica evita quebrar quando a versao do
  // ODA muda ou quando o .env ficou apontando para uma versao antiga.
  const pastasOda = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "ODA") : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "ODA") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "ODA") : null,
  ].filter((pasta): pasta is string => Boolean(pasta));

  for (const pastaOda of pastasOda) {
    candidatos.add(path.join(pastaOda, "ODAFileConverter.exe"));
    try {
      const entradas = await readdir(pastaOda, { withFileTypes: true });
      for (const entrada of entradas) {
        if (entrada.isDirectory() && /^ODAFileConverter/i.test(entrada.name)) {
          candidatos.add(path.join(pastaOda, entrada.name, "ODAFileConverter.exe"));
        }
      }
    } catch {
      // A pasta pode nao existir nessa maquina; os demais candidatos continuam.
    }
  }

  for (const candidato of candidatos) {
    if (await eArquivo(candidato)) return candidato;
  }

  const caminhoInformado = configurado ? ` Caminho configurado: ${configurado}.` : "";
  throw new Error(
    "Conversor de DWG nao encontrado no servidor." +
      caminhoInformado +
      " Instale o ODA File Converter ou ajuste ODA_CONVERTER_PATH no .env da API."
  );
}

async function listarDxfRecursivamente(pasta: string): Promise<string[]> {
  const encontrados: string[] = [];
  let entradas;
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    return encontrados;
  }

  for (const entrada of entradas) {
    const caminho = path.join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...(await listarDxfRecursivamente(caminho)));
    } else if (entrada.isFile() && entrada.name.toLowerCase().endsWith(".dxf")) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

function compactarSaida(saida: string): string {
  const compactada = saida.trim().replace(/\s+/g, " ");
  return compactada.length > 1000 ? compactada.slice(-1000) : compactada;
}

async function executarOda(
  converterPath: string,
  inputDir: string,
  outputDir: string,
  outputVersion: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      converterPath,
      [inputDir, outputDir, outputVersion, "DXF", "0", "1"],
      {
        windowsHide: true,
        // Algumas instalacoes do ODA dependem de DLLs relativas ao proprio
        // executavel; sem cwd a conversao pode falhar apenas no servidor.
        cwd: path.dirname(converterPath),
      }
    );
    let stdout = "";
    let stderr = "";
    let finalizado = false;
    const temporizador = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      proc.kill();
      reject(new Error(`A conversao do DWG excedeu ${TEMPO_LIMITE_CONVERSAO_MS / 60000} minutos.`));
    }, TEMPO_LIMITE_CONVERSAO_MS);

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.once("error", (err) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(temporizador);
      reject(new Error(`Nao foi possivel iniciar o ODA File Converter: ${err.message}`));
    });
    proc.once("close", (code, signal) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(temporizador);
      if (code === 0) {
        resolve();
        return;
      }

      const detalhes = compactarSaida(stderr || stdout);
      reject(
        new Error(
          `ODA File Converter terminou com codigo ${code ?? "desconhecido"}` +
            (signal ? ` (sinal ${signal})` : ".") +
            (detalhes ? ` Detalhes: ${detalhes}` : "")
        )
      );
    });
  });
}

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
  const converterPath = await localizarOdaFileConverter();

  const tmpRoot = path.join(PROCESSED_DIR, "_tmp");
  const inputDir = path.join(tmpRoot, `${plantaId}-in`);
  const outputDir = path.join(tmpRoot, `${plantaId}-out`);
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  try {
    // O arquivo recebido pelo upload ja tem nome seguro (UUID). Mesmo assim,
    // mantemos um nome controlado dentro da pasta de entrada para nao deixar
    // nomes originais com acentos ou caracteres especiais influenciarem o ODA.
    await copyFile(dwgPath, path.join(inputDir, `${plantaId}.dwg`));

    // Args do ODA File Converter: <pastaEntrada> <pastaSaida> <versaoSaida> <tipoSaida> <recursivo> <auditar>
    const outputVersion = process.env.ODA_OUTPUT_VERSION?.trim() || VERSAO_SAIDA_PADRAO;
    await executarOda(converterPath, inputDir, outputDir, outputVersion);

    const arquivosGerados = await listarDxfRecursivamente(outputDir);
    const arquivosComTamanho = await Promise.all(
      arquivosGerados.map(async (arquivo) => ({ arquivo, tamanho: (await stat(arquivo)).size }))
    );
    const dxfGerado = arquivosComTamanho.find((item) => item.tamanho > 0)?.arquivo;
    if (!dxfGerado) {
      throw new Error(
        "A conversao terminou sem gerar um DXF. O DWG pode estar corrompido ou usar uma versao/objeto nao suportado pelo conversor."
      );
    }

    const destino = path.join(PROCESSED_DIR, `${plantaId}.dxf`);
    await rename(dxfGerado, destino);
    return destino;
  } finally {
    // A limpeza nunca deve esconder a causa real da falha da conversao.
    await Promise.allSettled([
      rm(inputDir, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
    ]);
  }
}
