# Validação da referência do quarto

`npm run test:referencia` executa os testes de regressão sem navegador, servidor ou arquivos de clientes.

Para conferir a referência sobre o PDF real no Chrome:

1. Inicie a API em `localhost:3333` e o web em `localhost:5173`.
2. Use o projeto de teste local `Ronald`, com `QUARTO MENINAS.pdf` e briefing de áudio Bluetooth, dois pontos de rede no quarto e quadro no hall. O PDF precisa ser o mesmo usado na calibração.
3. Execute `node scripts/validar-quarto-browser.mjs CAMINHO_ABSOLUTO_DO_PLAYWRIGHT/index.mjs`, com Playwright disponível no ambiente de teste e Chrome instalado.

O navegador abre um contexto isolado. O teste permite somente GET/OPTIONS para a API, bloqueando gravações e exclusões. Exercita o editor e a exportação de verdade, gera evidências em `artifacts/` e verifica a preservação do quadro, as posições, as quantidades, a proporção, o zoom/pan e a correção de um ponto deslocado.

`node scripts/inspecionar-planta.mjs CAMINHO_DO_PDF` renderiza o original e recorta a área usada para a calibração. Não modifica o PDF. Os recortes são específicos desta folha; não representam detecção de cômodos em outras plantas. Não adicionar PDFs ou evidências de clientes ao Git.
