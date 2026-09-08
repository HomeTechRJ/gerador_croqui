@echo off
echo Parando o Gerador de Croqui...

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3333,5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

taskkill /FI "WINDOWTITLE eq Gerador de Croqui - API*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Gerador de Croqui - Site*" /T /F >nul 2>&1

echo Pronto.
pause
