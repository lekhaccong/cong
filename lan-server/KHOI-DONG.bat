@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>&1
if errorlevel 1 (
 echo Hay cai Node.js 24 LTS tu https://nodejs.org/en/download roi mo lai file nay.
 start "" "https://nodejs.org/en/download"
 pause
 exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0])===24?0:1)"
if errorlevel 1 (
 echo Can Node.js 24 LTS de chay ban thu nghiem nay.
 pause
 exit /b 1
)
if not exist node_modules\exceljs (
 call npm ci --omit=dev --ignore-scripts
 if errorlevel 1 (
  echo Cai thu vien that bai. Kiem tra Internet va thu lai.
  pause
  exit /b 1
 )
)
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8080'"
node server.mjs
pause
