@echo off
setlocal
pushd "%~dp0"

curl.exe --fail --silent --max-time 2 http://127.0.0.1:4173/ 2>nul | findstr.exe /L /C:"<title>Balance Quest" >nul
if not errorlevel 1 (
    start "" "http://127.0.0.1:4173/"
    popd
    exit /b 0
)

if not exist "node_modules\vite\bin\vite.js" (
    echo Run npm install in this folder, then open this file again.
    pause
    popd
    exit /b 1
)

if not exist "dist\index.html" (
    echo Run npm run build in this folder, then open this file again.
    pause
    popd
    exit /b 1
)

echo Keep this window open while using Balance Quest.
call npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort --open
set "balance_exit=%errorlevel%"
if not "%balance_exit%"=="0" pause
popd
exit /b %balance_exit%
