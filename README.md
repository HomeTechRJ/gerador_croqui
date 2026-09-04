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
| 4 | Editor: clicar pra colocar símbolo, clicar nele pra remover, múltiplas plantas, salvar versão | ✅ (mover/girar um símbolo já colocado fica pra 4.1) |
| 5 | Exportar croqui final (PDF/PNG) | — |

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
  web/      # React + TypeScript + Vite — o editor visual (canvas com react-konva)
  api/      # Node + TypeScript + Fastify — upload, conversão de arquivos, dados do projeto
packages/
  shared/   # Tipos compartilhados entre web e api (símbolos, questionário, projeto)
```

## Rodando localmente

```bash
npm install

npm run dev:api   # http://localhost:3333  (GET /health)
npm run dev:web   # http://localhost:5173
```

Pra converter DWG, copie `apps/api/.env.example` para `apps/api/.env` e aponte
`ODA_CONVERTER_PATH` para o executável do
[ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
instalado na máquina. Sem isso, um upload de DWG retorna erro explicando o que falta —
PDF e DXF funcionam sem nenhuma configuração extra.

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

O editor (Fase 4) já usa esse fluxo: clicar na planta com um símbolo
selecionado na paleta cria um ponto local; "Salvar versão" grava tudo de uma
vez via `POST /projetos/:id/croquis`. O seletor de versão no topo troca qual
versão está carregada pra edição (sempre gera uma versão nova ao salvar,
nunca sobrescreve a antiga).

Fica pra depois (não bloqueia o uso, mas vale registrar):
- Mover/girar um símbolo já colocado (hoje só dá pra colocar e remover).
- Campo "ambiente" por ponto (a coluna já existe no banco, só falta o campo no editor).
- Visualizar DXF no editor (por enquanto só PDF é editável).
