import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuestionarioProjeto } from '@croqui/shared';
import type { AmbienteDetectado } from '../apps/web/src/lib/detectarAmbientes';
import { aplicarReferenciasDaPlanta } from '../apps/web/src/lib/referenciasPlanta';
import { calcularPosicoesDaSugestao, sugerirParaAmbiente, sugerirPeloBriefing } from '../apps/web/src/lib/motorDeRegras';

const hash = 'f8508c1fab627d343f4772613dd2ae735bd7a351e520b6a79f82f4a4fe242087';
const viewport = (escala = 2) => ({
  convertToViewportPoint: (x: number, y: number) => [x * escala, (1191 - y) * escala],
});
const quarto = (escala = 2): AmbienteDetectado => ({
  nome: 'QUARTO DAS MENINAS', areaM2: null,
  posX: 371.28 * escala, posY: (1191 - 270.6) * escala,
  // Reproduz um limite errado do detector: nunca deve recortar a referência.
  limites: { minX: 950, minY: 1800, maxX: 1100, maxY: 2000 },
  ancoras: [],
});
const escritorio = (escala = 2): AmbienteDetectado => ({
  nome: 'ESCRITÓRIO', areaM2: null,
  posX: 418.68 * escala, posY: (1191 - 975) * escala,
  limites: { minX: 650, minY: 300, maxX: 1000, maxY: 600 },
  ancoras: [],
});
const calibrar = () => aplicarReferenciasDaPlanta([quarto()], hash, viewport());
const posicionar = (simboloId: string, quantidade: number, ambientes = calibrar()) =>
  calcularPosicoesDaSugestao({ simboloId, quantidade, ambiente: ambientes[0].nome,
    posX: ambientes[0].posX, posY: ambientes[0].posY }, ambientes);

test('duas caixas nos pés das camas, junto às extremidades superiores, mesmo sem texto de móveis', () => {
  for (const tipo of ['caixa-embutir', 'caixa-embutir-bluetooth']) {
    const pontos = posicionar(tipo, 2);
    assert.equal(pontos.length, 2);
    assert.ok(pontos[0].x >= 692 && pontos[0].x <= 708);
    assert.ok(pontos[1].x >= 866 && pontos[1].x <= 882);
    assert.ok(pontos.every((p) => p.y >= 1830 && p.y <= 1843));
  }
});

test('rede agrupada na estante superior, não no centro nem no contorno estimado', () => {
  const pontos = posicionar('ponto-de-rede', 2);
  assert.equal(pontos.length, 2);
  assert.ok(pontos.every((p) => p.x >= 670 && p.x <= 704 && p.y >= 1768 && p.y <= 1780));
  assert.ok(pontos[1].x - pontos[0].x >= 14 && pontos[1].x - pontos[0].x <= 24);
});

test('converte coordenadas PDF com a escala e a orientação do viewport', () => {
  const base = calibrar()[0].referencia!;
  for (const escala of [1, 3, 4]) {
    const referencia = aplicarReferenciasDaPlanta([quarto(escala)], hash, viewport(escala))[0].referencia!;
    assert.deepEqual(referencia.caixas, base.caixas.map((p) => ({ x: p.x * escala / 2, y: p.y * escala / 2 })));
    assert.deepEqual(referencia.rede, base.rede.map((p) => ({ x: p.x * escala / 2, y: p.y * escala / 2 })));
  }
  const girado = { convertToViewportPoint: (x: number, y: number) => [y * 2 + 10, x * 2 + 20] };
  const [posX, posY] = girado.convertToViewportPoint(371.28, 270.6);
  const referencia = aplicarReferenciasDaPlanta([{ ...quarto(), posX, posY }], hash, girado)[0].referencia!;
  assert.deepEqual(referencia.caixas, [{ x: 554, y: 720 }, { x: 554, y: 894 }]);
});

test('não aplica a outro PDF com o mesmo nome de cômodo ou a outro cômodo da folha', () => {
  const ambientes = [quarto()];
  assert.equal(aplicarReferenciasDaPlanta(ambientes, 'outro-pdf', viewport()), ambientes);
  const sala = { ...quarto(), nome: 'SALA' };
  const outroQuarto = { ...quarto(), posY: 800 };
  const resultado = aplicarReferenciasDaPlanta([sala, outroQuarto], hash, viewport());
  assert.equal(resultado[0], sala);
  assert.equal(resultado[1], outroQuarto);
  assert.ok(resultado.every((a) => !a.referencia));
});

test('conteúdo idêntico reaplica a referência sem mutar a detecção nem compartilhar posições editáveis', () => {
  const original = quarto();
  const primeira = aplicarReferenciasDaPlanta([original], hash, viewport())[0];
  assert.equal(original.referencia, undefined);
  assert.equal(primeira.limites, original.limites);
  const pontos = posicionar('ponto-de-rede', 2, [primeira]);
  pontos[0].x = 0;
  assert.notEqual(primeira.referencia!.rede[0].x, 0);
  assert.deepEqual(aplicarReferenciasDaPlanta([original], hash.toUpperCase(), viewport())[0].referencia, primeira.referencia);
});

test('honra zero e não inventa posições excedentes à referência', () => {
  assert.deepEqual(posicionar('caixa-embutir-bluetooth', 0), []);
  assert.deepEqual(posicionar('ponto-de-rede', 0), []);
  assert.equal(posicionar('ponto-de-rede', 1).length, 1);
  assert.equal(posicionar('ponto-de-rede', 4).length, 2);
});

test('rede sem referência ou móvel identificado fica pendente em vez de flutuar fora da planta', () => {
  const brinquedoteca = { ...quarto(), nome: 'BRINQUEDOTECA' };
  assert.deepEqual(posicionar('ponto-de-rede', 2, [brinquedoteca]), []);
  assert.deepEqual(posicionar('ponto-de-rede', 2, [quarto()]), []);
});

test('escritório usa três referências na bancada: dois computadores e uma possível impressora', () => {
  const ambientes = aplicarReferenciasDaPlanta([escritorio()], hash, viewport());
  const referencia = ambientes[0].referencia!;
  assert.equal(referencia.id, 'escritorio-referencia-final-v1');
  const pontos = posicionar('ponto-de-rede', 3, ambientes);
  assert.deepEqual(pontos, [
    { x: 810, y: 362 },
    { x: 824, y: 362 },
    { x: 899, y: 362 },
  ]);
  assert.deepEqual(posicionar('ponto-de-rede', 4, ambientes), pontos);
});

test('briefing produz duas caixas Bluetooth e respeita serviços desmarcados e quantidade zero', () => {
  const ambientes = calibrar();
  const questionario: QuestionarioProjeto = { projetoId: 'teste', servicos: ['audio', 'rede'],
    ambientes: [{ ...quarto(), plantaId: 'planta', caixasSom: 1, pontosRede: 2, tipoAudio: 'bluetooth' }] };
  const sugestoes = sugerirPeloBriefing(ambientes, questionario, 'planta');
  assert.deepEqual(sugestoes.map((s) => [s.simboloId, s.quantidade]), [['caixa-embutir-bluetooth', 2], ['ponto-de-rede', 2]]);
  assert.deepEqual(sugerirPeloBriefing(ambientes, { ...questionario, servicos: [] }, 'planta'), []);
  assert.deepEqual(sugerirPeloBriefing(ambientes, { ...questionario,
    ambientes: questionario.ambientes!.map((a) => ({ ...a, caixasSom: 0, pontosRede: 0 })) }, 'planta'), []);
  assert.deepEqual(sugerirPeloBriefing(ambientes, questionario, 'outra-planta'), []);
});

test('referência não modifica o posicionamento do quadro de automação nem do UniFi', () => {
  for (const tipo of ['quadro-automacao', 'unifi-ap']) {
    assert.deepEqual(posicionar(tipo, 1, calibrar()), posicionar(tipo, 1, [quarto()]));
  }
});

test('escritório recomenda três pontos: dois computadores e uma possível impressora', () => {
  const ambiente: AmbienteDetectado = {
    nome: 'ESCRITÓRIO', areaM2: null, posX: 837, posY: 432, limites: undefined, ancoras: [],
  };
  const sugestao = sugerirParaAmbiente(ambiente, ['rede']);
  assert.equal(sugestao.length, 1);
  assert.equal(sugestao[0].simboloId, 'ponto-de-rede');
  assert.equal(sugestao[0].quantidade, 3);
  assert.match(sugestao[0].observacao ?? '', /computador.*impressora/);
});
