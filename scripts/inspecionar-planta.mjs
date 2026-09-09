import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o caminho do PDF.');
const documento = await pdfjs.getDocument({ data: new Uint8Array(await readFile(arquivo)) }).promise;
const pagina = await documento.getPage(1);
const viewport = pagina.getViewport({ scale: 2 });
const canvas = createCanvas(viewport.width, viewport.height);
await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
await mkdir('artifacts', { recursive: true });
const recorte = createCanvas(1200, 960);
recorte.getContext('2d').drawImage(canvas, 540, 1540, 600, 480, 0, 0, 1200, 960);
await writeFile('artifacts/planta-original-quarto.png', recorte.toBuffer('image/png'));
console.log(JSON.stringify({ tamanho: [viewport.width, viewport.height], fingerprint: documento.fingerprints, textos: (await pagina.getTextContent()).items }, null, 2));
await documento.destroy();
