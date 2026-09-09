import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Recebe o modulo Playwright instalado no ambiente de teste, sem escrever no banco.
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const erros = [];
page.on('pageerror', (erro) => erros.push(erro.message));
await page.route('http://localhost:3333/**', (route) =>
  ['GET', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort()
);
await mkdir('artifacts', { recursive: true });
try {
  await page.goto('http://localhost:5173');
  await page.locator('.item-projeto').filter({ hasText: 'Ronald' }).click();
  const aplicar = page.getByRole('button', { name: /Aplicar .* planta/ });
  await aplicar.waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: 'Gerar pelo briefing' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ponto-item').length > 0);
  const lerPontos = () => page.locator('.ponto-item').evaluateAll((itens) => itens.map((item) => ({
    titulo: item.querySelector('.ponto-marcador').title,
    x: parseFloat(item.style.left) * 1684 / 100,
    y: parseFloat(item.style.top) * 2382 / 100,
  })));
  const gerados = await lerPontos();
  const quarto = gerados.filter((ponto) => ponto.titulo.includes('QUARTO DAS MENINAS'));
  const escritorio = gerados.filter((ponto) => ponto.titulo.includes('ESCRITÓRIO') && ponto.titulo.includes('Ponto de rede')).sort((a, b) => a.x - b.x);
  const caixas = quarto.filter((ponto) => ponto.titulo.includes('bluetooth')).sort((a, b) => a.x - b.x);
  const rede = quarto.filter((ponto) => ponto.titulo.includes('Ponto de rede')).sort((a, b) => a.x - b.x);
  assert.equal(caixas.length, 2);
  assert.equal(rede.length, 2);
  // Alvos medidos no PDF original, independentes do retangulo estimado pelo detector.
  assert.ok(caixas[0].x >= 692 && caixas[0].x <= 708 && caixas[0].y >= 1830 && caixas[0].y <= 1843);
  assert.ok(caixas[1].x >= 866 && caixas[1].x <= 882 && caixas[1].y >= 1830 && caixas[1].y <= 1843);
  assert.ok(rede.every((ponto) => ponto.x >= 670 && ponto.x <= 704 && ponto.y >= 1768 && ponto.y <= 1780));
  assert.ok(rede[1].x - rede[0].x >= 14 && rede[1].x - rede[0].x <= 24);
  assert.deepEqual(escritorio.map((ponto) => [Math.round(ponto.x), Math.round(ponto.y)]), [[810, 362], [824, 362], [899, 362]]);
  assert.equal(gerados.filter((ponto) => ponto.titulo.includes('Ponto de rede')).length, 5);
  const mensagem = await page.locator('.aviso-inline').allTextContents();
  assert.ok(mensagem.some((texto) => texto.includes('BRINQUEDOTECA') && texto.includes('Local ainda não identificado')));
  const quadroAntes = gerados.find((ponto) => ponto.titulo.includes('Quadro de automação'));
  assert.ok(quadroAntes);
  const caixasEscritorioAntes = gerados
    .filter((ponto) => ponto.titulo.includes('Caixa de embutir') && ponto.titulo.includes('ESCRITÓRIO'))
    .sort((a, b) => a.x - b.x);
  await aplicar.click();
  await aplicar.click();
  const reaplicados = await lerPontos();
  assert.equal(reaplicados.filter((ponto) => ponto.titulo.includes('QUARTO DAS MENINAS')).length, 4);
  assert.deepEqual(reaplicados.find((ponto) => ponto.titulo.includes('Quadro de automação')), quadroAntes);
  assert.deepEqual(
    reaplicados.filter((ponto) => ponto.titulo.includes('Caixa de embutir') && ponto.titulo.includes('ESCRITÓRIO')).sort((a, b) => a.x - b.x),
    caixasEscritorioAntes
  );
  await page.getByRole('button', { name: 'Gerar pelo briefing' }).click();
  assert.equal((await lerPontos()).length, reaplicados.length);
  const medidas = await page.locator('.canvas-stage').evaluate((stage) => {
    const rect = stage.getBoundingClientRect();
    return { width: stage.offsetWidth, height: stage.offsetHeight, proporcao: rect.width / rect.height };
  });
  assert.equal(medidas.width, 1684);
  assert.equal(medidas.height, 2382);
  assert.ok(Math.abs(medidas.proporcao - 1684 / 2382) < 0.001);
  // Exercita zoom/pan reais e depois exporta o mesmo arranjo do editor.
  await page.locator('.canvas-wrapper').dispatchEvent('wheel', { deltaY: -120, clientX: 800, clientY: 500 });
  await page.waitForFunction(() => !document.querySelector('.canvas-stage').style.transform.includes('scale(1)'));
  async function centralizarQuarto() {
    for (let tentativa = 0; tentativa < 15; tentativa++) {
      const mover = await page.evaluate(() => {
        const stage = document.querySelector('.canvas-stage').getBoundingClientRect();
        const wrapper = document.querySelector('.canvas-wrapper').getBoundingClientRect();
        const topo = Math.max(0, wrapper.top), base = Math.min(innerHeight, wrapper.bottom);
        const centro = { x: wrapper.x + wrapper.width / 2, y: (topo + base) / 2 };
        const dx = centro.x - (stage.x + 825 * stage.width / 1684);
        const dy = centro.y - (stage.y + 1770 * stage.height / 2382);
        const inicio = { ...centro };
        if (document.elementFromPoint(inicio.x, inicio.y)?.closest('.ponto-item')) inicio.x -= 200;
        return { inicio, dx: Math.max(-250, Math.min(250, dx)), dy: Math.max(-250, Math.min(250, dy)) };
      });
      if (Math.abs(mover.dx) < 1 && Math.abs(mover.dy) < 1) return;
      await page.mouse.move(mover.inicio.x, mover.inicio.y);
      await page.mouse.down();
      await page.mouse.move(mover.inicio.x + mover.dx, mover.inicio.y + mover.dy, { steps: 8 });
      await page.mouse.up();
    }
    assert.fail('Pan não centralizou a área do quarto');
  }
  await centralizarQuarto();
  for (let indice = 0; indice < 4; indice++) {
    await page.locator('.canvas-wrapper').dispatchEvent('wheel', { deltaY: -120, clientX: 840, clientY: 597 });
  }
  await centralizarQuarto();
  await page.locator('.canvas-stage').waitFor({ state: 'visible' });
  assert.deepEqual(await lerPontos(), reaplicados);
  // Confere os quatro símbolos efetivamente dentro da área visível do editor.
  const visiveis = await page.locator('.ponto-marcador').evaluateAll((marcadores) => marcadores
    .filter((item) => item.title.includes('QUARTO DAS MENINAS'))
    .every((item) => { const r = item.getBoundingClientRect(); return r.x >= 240 && r.right <= innerWidth && r.y > 195 && r.bottom <= innerHeight; }));
  assert.ok(visiveis);
  // Simula a versão antiga deslocando um ponto, e verifica que aplicar corrige.
  const redeQuarto = page.locator('.ponto-marcador[title^="Ponto de rede — QUARTO DAS MENINAS"]').first();
  const retangulo = await redeQuarto.boundingBox();
  await page.mouse.move(retangulo.x + retangulo.width / 2, retangulo.y + retangulo.height / 2);
  await page.mouse.down();
  await page.mouse.move(retangulo.x + 90, retangulo.y + 120, { steps: 6 });
  await page.mouse.up();
  assert.notDeepEqual(await lerPontos(), reaplicados);
  await aplicar.click();
  assert.deepEqual(await lerPontos(), reaplicados);
  // O briefing desmonta o editor. O rascunho precisa sobreviver mesmo sem
  // salvar uma nova versão do croqui.
  const antesDeEditarBriefing = await lerPontos();
  await page.getByRole('button', { name: 'Editar briefing' }).click();
  await page.getByRole('heading', { name: 'Vamos definir o croqui' }).waitFor();
  await page.getByRole('button', { name: 'Voltar para a planta' }).click();
  await page.getByRole('button', { name: 'Editar briefing' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.ponto-item')]
    .some((item) => item.getAttribute('style')?.includes('left:') && !item.getAttribute('style')?.includes('left: 0%')));
  assert.deepEqual(await lerPontos(), antesDeEditarBriefing);
  await centralizarQuarto();
  await page.screenshot({ path: 'artifacts/quarto-editor-validado.png' });
  const exportado = await page.evaluate(async (pontos) => {
    const { renderizarPaginaCroqui } = await import('/src/lib/exportarCroqui.ts');
    const api = await import('/src/api.ts');
    const { SIMBOLOS_PADRAO } = await import('/@fs/C:/projetos-ht/Gerador-Croqui/packages/shared/src/index.ts');
    const projetos = await api.listarProjetos();
    const projeto = projetos.find((item) => item.nomeCliente === 'Ronald');
    const plantas = await api.listarPlantasDoProjeto(projeto.id);
    const planta = plantas.find((item) => item.nomeArquivoOriginal === 'QUARTO MENINAS.pdf');
    const simbolos = new Map(SIMBOLOS_PADRAO.map((simbolo) => [simbolo.id, simbolo]));
    const pontosExportacao = pontos.map((ponto) => ({
      simboloId: SIMBOLOS_PADRAO.find((simbolo) => ponto.titulo.startsWith(simbolo.nome + ' —')).id,
      posX: ponto.x, posY: ponto.y, rotacao: 0,
    }));
    const canvas = await renderizarPaginaCroqui(planta, pontosExportacao, simbolos);
    const recorte = document.createElement('canvas');
    recorte.width = 1200;
    recorte.height = 960;
    recorte.getContext('2d').drawImage(canvas, 540, 1540, 600, 480, 0, 0, 1200, 960);
    return recorte.toDataURL('image/png').split(',')[1];
  }, reaplicados);
  await writeFile('artifacts/quarto-exportado-validado.png', Buffer.from(exportado, 'base64'));
  assert.deepEqual(erros, []);
  console.log(JSON.stringify({ gerados, medidas, mensagem, testes: 'posições, quantidades, reaplicação, duplicação, quadro preservado, zoom/pan e exportação: OK' }, null, 2));
} finally {
  await browser.close();
}
