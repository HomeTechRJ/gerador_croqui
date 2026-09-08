@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Gerador de Croqui
echo ============================================
echo.

if not exist "node_modules" (
    echo Primeira vez rodando - instalando dependencias, aguarde...
    call npm install
    echo.
)

echo Iniciando o servidor da API...
start "Gerador de Croqui - API (nao feche)" cmd /k "npm run dev:api"

echo Iniciando o site...
start "Gerador de Croqui - Site (nao feche)" cmd /k "npm run dev:web"

echo Aguardando os servidores subirem...
ping -n 7 127.0.0.1 >nul

echo Abrindo o navegador...
start "" "http://localhost:5173"

echo.
echo ============================================
echo Tudo rodando! O site deve ter aberto no navegador.
echo Se nao abriu sozinho, acesse: http://localhost:5173
echo.
echo Para PARAR, feche as duas janelas pretas que abriram
echo (ou rode o arquivo parar-croqui.bat).
echo ============================================
echo.
pause
