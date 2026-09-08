# Gerador de Croqui

Ferramenta interna para gerar o croqui (planta esquemática com os símbolos dos
equipamentos — som, rede, automação etc.) a partir da planta do cliente
(DWG/PDF), para apresentar o escopo do projeto antes da execução.

## Visão geral / roadmap

| Fase | Entregável | Status |
|---|---|---|
| 0 | Esqueleto do monorepo | ✅ |
| 1 | Upload da planta (PDF/DXF/DWG), conversão DWG→DXF, visualização com pan/zoom | ✅ (DXF ainda só converte, visualização vem na 1.1) |
| 2 | Fluxo projeto → questionário (som? rede? automação?) → banco com versionamento | ✅ |
| 3 | Paleta de símbolos filtrada pelo questionário | ✅ |
| 4 | Editor: colocar, selecionar, mover e girar símbolo, múltiplas plantas, salvar versão | ✅ |
| 5 | Exportar croqui final (PDF/PNG) com legenda automática | ✅ |
| 6 | Detecção automática de ambientes (lê o texto do PDF) + campo "ambiente" | ✅ (validado com PDF sintético; falta confirmar com planta real) |
| 6.1 | Motor de regras (sugerir equipamento sozinho por tipo/metragem de ambiente) | ✅ — regras da entrevista de 08/09/2026 com o usuário |

Decisões já tomadas:
- **DWG**: convertido para DXF via [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
  rodando self-hosted no back-end (gratuito, sem custo por arquivo).
- **Escopo inicial**: uso interno da equipe (sem multi-tenant por enquanto).
- **Banco de dados**: SQLite local (`apps/api/data/croqui.db`), standalone — **sem
  relação com o Supabase/ERP da Home e Tech**, decisão explícita pra manter esse
  app simples e isolado por enquanto (mesmo já existindo lá um schema parecido
  para `croquis`/`croqui_plantas`/`croqui_pontos`).

## Estrutura

```
apps/
  web/      # React + TypeScript + Vite — o editor visual (pdf.js + overlay em DOM)
  api/      # Node + TypeScript + Fastify — upload, conversão de arquivos, dados do projeto
packages/
  shared/   # Tipos compartilhados entre web e api (símbolos, questionário, projeto)
```

## Rodando localmente

**Jeito fácil (Windows):** dá duplo-clique em `iniciar-croqui.bat` — instala as
dependências na primeira vez, sobe os dois servidores em janelas separadas e
abre o navegador sozinho em `http://localhost:5173`. Pra parar, `parar-croqui.bat`
(ou só fechar as duas janelas pretas).

**Manual:**
```bash
npm install

npm run dev:api   # http://localhost:3333  (GET /health)
npm run dev:web   # http://localhost:5173
```

Pra converter DWG, copie `apps/api/.env.example` para `apps/api/.env` e aponte
`ODA_CONVERTER_PATH` para o executável do
[ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
instalado na máquina (a API carrega o `.env` sozinha via `dotenv`). Sem isso,
um upload de DWG retorna erro explicando o que falta — PDF e DXF funcionam
sem nenhuma configuração extra.

**Já instalado e configurado nesta máquina** (08/09/2026): ODA File Converter
27.1.0, instalação por usuário (não precisou de admin — usei
`MSIINSTALLPERUSER=1`, já que a instalação padrão "para todos os usuários"
pede elevação). Testado com um DWG real de verdade (não só PDF sintético):
converteu certinho pra DXF. Numa máquina nova, seria preciso repetir essa
instalação.

## Stack

- **Front-end**: React + TypeScript + Vite. `pdf.js` renderiza o PDF num
  `<canvas>`; os símbolos posicionados são overlay em DOM (`<button>`
  posicionado por `left`/`top`) por cima do canvas, não desenhados dentro
  dele — mais simples de clicar/remover, sem depender de lib de canvas.
- **Back-end**: Node + TypeScript + Fastify.
- **Banco de dados**: SQLite via `node:sqlite` (nativo do Node, sem dependência
  extra) — arquivo em `apps/api/data/croqui.db`, criado automaticamente no
  primeiro boot da API.
- **Monorepo**: npm workspaces.

## Dados e versionamento

- `projetos` → `plantas` (1 por planta importada) e `questionarios` (1 por projeto).
- `croquis`: cada "salvar" do editor (Fase 4) grava uma **versão nova**
  (`projeto_id` + `versao` incremental), nunca sobrescreve — dá pra manter
  histórico completo de como o croqui evoluiu.
- `croqui_pontos`: os símbolos posicionados dentro de uma versão específica.

O editor (Fase 4) já usa esse fluxo: colocar um símbolo novo funciona de duas
formas — **arrastar** da paleta até a planta (drag-and-drop nativo do
navegador), ou clicar nele na paleta e depois clicar na planta. Clicar num
ponto já colocado seleciona ele (mostra alça de girar e botão de remover);
arrastar a forma move; arrastar a alça gira (grava em graus, campo
`rotacao`). "Salvar versão"
grava tudo de uma vez via `POST /projetos/:id/croquis`. O seletor de versão no
topo troca qual versão está carregada pra edição (sempre gera uma versão nova
ao salvar, nunca sobrescreve a antiga).

Fica pra depois (não bloqueia o uso, mas vale registrar):
- Visualizar/exportar DXF (por enquanto só plantas em PDF são editáveis e exportáveis).
- Regras que a entrevista não cobriu (áudio em quarto comum sem ser master,
  critério de distância por pé-direito quando esse dado existir na planta).

## Detecção automática de ambientes (Fase 6)

As plantas de referência são PDF **vetorial** (o texto "SUÍTE MASTER A:14.31m²"
já é texto de verdade dentro do arquivo, não desenho/imagem escaneada). O app
lê esse texto com `pdf.js` (`getTextContent()`), casa cada rótulo de área
("A:14.31m²") com o nome mais próximo, e assim descobre os ambientes e
metragens **sem nenhuma IA e sem o usuário digitar nada** — ver
[`lib/detectarAmbientes.ts`](apps/web/src/lib/detectarAmbientes.ts).

Isso alimenta o campo `ambiente` de cada ponto automaticamente: ao plantar um
símbolo perto de um ambiente detectado, o nome do ambiente é preenchido
sozinho (aparece no título do marcador e é salvo com a versão). Os ambientes
detectados aparecem como pontinhos discretos na planta (dá pra esconder pelo
checkbox "N ambientes detectados" no topo).

## Motor de regras / "Sugerir automaticamente" (Fase 6.1)

Regras capturadas numa entrevista com o usuário em 08/09/2026 (não havia
documento formal - o critério estava na experiência de quem projeta), em
[`lib/motorDeRegras.ts`](apps/web/src/lib/motorDeRegras.ts). Casam o **nome**
do ambiente detectado (regex, ignorando acento/caixa) com o(s) serviço(s)
contratados no questionário:

| Ambiente (por nome) | Serviço | Gera |
|---|---|---|
| Suíte master | Áudio | 2× caixa de embutir |
| Banheiro master | Áudio | 1× caixa de embutir |
| Closet | Áudio | 1× caixa de embutir |
| Home / Cinema / Theater | Áudio | 5× caixa de embutir + 1× subwoofer (5.1) + 1× receiver |
| Área externa / Piscina / Jardim / Varanda | Áudio | 1× caixa outdoor ⚠️ *(marcado pra revisar - pode ser bookshelf, depende do local)* |
| Quarto / Suíte (dormitório) | Rede | 2× ponto de rede |
| Sala / Estar / Home / Cinema | Rede | 3× ponto de rede ⚠️ *(4 se o ambiente também tiver som)* |
| Sala / Estar | Áudio | 1× multiroom |
| Gourmet | Rede | 2× ponto de rede |
| **Por andar** | Rede | 1-2× Unifi AP, por metragem total do andar (~120m² por AP, considerando perda de sinal) ⚠️ |
| **Por andar** | Automação | 1× quadro de automação ⚠️ *(posição é só um ponto de partida - vocês reposicionam perto do quadro elétrico real)* |

O botão **"✨ Sugerir automaticamente"** no editor roda essas regras contra os
ambientes detectados na planta ativa e adiciona os pontos sugeridos - cada um
continua **100% editável**: mover, girar, remover, ajustar quantidade, igual
a qualquer ponto colocado manualmente. Os marcados com ⚠️ acima ganham um
contorno tracejado laranja na tela, indicando "revisar antes de fechar" -
são os casos que o próprio usuário descreveu como dependendo de análise
(ex: piscina pode levar bookshelf ou caixa externa dependendo do projeto).
Clicar em "Sugerir" de novo não duplica o que já foi sugerido antes (mas
não impede colocar mais manualmente).

Testado com um PDF sintético cobrindo os 8 tipos de ambiente da tabela:
as 28 sugestões geradas bateram exatamente com o esperado, e clicar duas
vezes não duplicou nada.

**Ainda sem cobertura:** áudio em quarto comum (não-master) - o usuário não
deu um critério específico pra esse caso, então não inventei um.

**Importante:** testei com um PDF sintético que imita o formato dos rótulos
reais e funcionou 100%, mas ainda não confirmei com uma planta de verdade de
vocês — o espaçamento/formatação real pode exigir ajuste fino na distância
usada pra casar nome + área (`DISTANCIA_MAX_PX` no arquivo acima).

Essa detecção é a base necessária pro **motor de regras** (Fase 6.1): só faz
sentido sugerir equipamento automaticamente depois que o app sabe onde estão
os ambientes e qual o tamanho de cada um.

## Exportação (Fase 5)

"Exportar PNG" gera a planta ativa com os símbolos + legenda (só os símbolos
realmente usados nela); "Exportar PDF" gera um PDF com uma página por planta
do projeto (útil quando tem mais de um pavimento), cada página com sua
própria legenda. Tudo desenhado num `<canvas>` novo (não a tela do editor) via
Canvas 2D, então o resultado fica limpo mesmo com zoom/pan aplicados na hora
de editar. O jsPDF só é carregado quando "Exportar PDF" é clicado (import
dinâmico) pra não pesar o carregamento inicial do app.
