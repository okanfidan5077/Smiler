@echo off
rem Starts everything needed for a review session, skipping what is already running:
rem Ollama (LLM), the Smiler service (server/, port 8787) and the admin page (admin/, port 5173),
rem then opens the admin page. n8n/Docker are not needed for manual "Generate" + review.
rem Double-click it, or run: start-review.cmd [--no-open]

setlocal
set "ROOT=%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "NPM=%ProgramFiles%\nodejs\npm.cmd"

curl -s -m 2 http://localhost:11434/api/version >nul 2>&1
if errorlevel 1 (
  echo Starting Ollama...
  start "Ollama" /min "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
) else (
  echo Ollama already running.
)

curl -s -m 2 http://localhost:8787/health >nul 2>&1
if errorlevel 1 (
  echo Starting Smiler service...
  start "Smiler service" /min cmd /k "cd /d "%ROOT%server" && "%NODE%" src\index.js"
) else (
  echo Smiler service already running.
)

curl -s -m 2 http://localhost:5173 >nul 2>&1
if errorlevel 1 (
  echo Starting admin page...
  start "Smiler admin" /min cmd /k "cd /d "%ROOT%admin" && "%NPM%" run dev"
) else (
  echo Admin page already running.
)

echo Waiting for everything to answer...
for /l %%i in (1,1,30) do (
  curl -s -m 2 http://localhost:8787/health >nul 2>&1 && curl -s -m 2 http://localhost:5173 >nul 2>&1 && curl -s -m 2 http://localhost:11434/api/version >nul 2>&1 && goto ready
  timeout /t 2 /nobreak >nul
)
echo Something did not start. Check the minimized "Smiler service", "Smiler admin" and "Ollama" windows.
pause
exit /b 1

:ready
echo All up: admin http://localhost:5173 - service http://localhost:8787 - Ollama :11434
rem Daily snapshot of approved memes and decisions to OneDrive\SmilerBackups (runs in its own window).
start "Smiler backup" /min "%NODE%" "%ROOT%server\scripts\backup.js"
if /i not "%~1"=="--no-open" start "" http://localhost:5173
endlocal
