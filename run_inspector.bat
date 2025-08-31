@echo off
REM Lokale EquipmentCloud-Settings setzen
set EC_CLOUD_BASE_URL=https://eqcloud.kontron-ais.com/C1681906/cloudconnect/api
set EC_USER=##username##
set EC_PASS=##password##
set EC_LANG=de-de

echo Environment variables gesetzt:
echo  EC_CLOUD_BASE_URL=%EC_CLOUD_BASE_URL%
echo  EC_USER=%EC_USER%
echo  EC_PASS=*****
echo  EC_LANG=%EC_LANG%

REM Inspector mit deinem Server starten
npx @modelcontextprotocol/inspector node build/server.js
