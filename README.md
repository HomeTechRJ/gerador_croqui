# Gerador de Croqui

Ferramenta interna para gerar o croqui (planta esquemática com os símbolos dos
equipamentos — som, rede, automação etc.) a partir da planta do cliente
(DWG/PDF), para apresentar o escopo do projeto antes da execução.

## Visão geral / roadmap

| Fase | Entregável | Status |
|---|---|---|
| 0 | Esqueleto do monorepo | ✅ |
| 1 | Upload da planta (PDF/DXF/DWG), conversão DWG→DXF, visualização com pan/zoom | 🔜 |
| 2 | Questionário dinâmico (som? rede? automação? Unifi? etc.) | — |
| 3 | Biblioteca de símbolos/legenda | — |
| 4 | Editor manual (arrastar, mover, girar, duplicar símbolos) | — |
| 5 | Exportar croqui final (PDF/PNG) + versionamento de projeto | — |

Decisões já tomadas:
- **DWG**: convertido para DXF via [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
  rodando self-hosted no back-end (gratuito, sem custo por arquivo).
- **Escopo inicial**: uso interno da equipe (sem multi-tenant por enquanto).

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

## Stack

- **Front-end**: React + TypeScript + Vite, `react-konva` para o canvas
  interativo, `pdf.js` para renderizar PDF.
- **Back-end**: Node + TypeScript + Fastify.
- **Banco de dados**: PostgreSQL (a ser adicionado na Fase 2).
- **Monorepo**: npm workspaces.
