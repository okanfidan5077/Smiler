@echo off
rem Starts everything needed for a review session, skipping what is already running:
rem Ollama (LLM), ComfyUI (images, port 8188), the Smiler service (server/, port 8787) and the
rem admin page (admin/, port 5173), then opens the admin page. n8n/Docker are not needed.
rem ComfyUI's folder can be changed with the COMFYUI_DIR environment variable.
rem Double-click it, or run: start-review.cmd [--no-open]

setlocal
set "ROOT=%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not defined COMFYUI_DIR set "COMFYUI_DIR=C:\AI_TOOLS\ComfyUI\ComfyUI"

curl -s -m 2 http://localhost:11434/api/version >nul 2>&1
if errorlevel 1 (
  echo Starting Ollama...
  start "Ollama" /min "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
) else (
  echo Ollama already running.
)

curl -s -m 2 http://127.0.0.1:8188/system_stats >nul 2>&1
if errorlevel 1 (
  echo Starting ComfyUI...
  start "ComfyUI" /min /d "%COMFYUI_DIR%" "%COMFYUI_DIR%\venv\Scripts\python.exe" main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch
) else (
  echo ComfyUI already running.
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
for /l %%i in (1,1,45) do (
  curl -s -m 2 http://localhost:8787/health >nul 2>&1 && curl -s -m 2 http://localhost:5173 >nul 2>&1 && curl -s -m 2 http://localhost:11434/api/version >nul 2>&1 && curl -s -m 2 http://127.0.0.1:8188/system_stats >nul 2>&1 && goto ready
  ping -n 3 127.0.0.1 >nul
)
echo Something did not start. Check the minimized "Smiler service", "Smiler admin", "ComfyUI" and "Ollama" windows.
pause
exit /b 1

:ready
echo All up: admin http://localhost:5173 - service :8787 - Ollama :11434 - ComfyUI :8188
rem Daily snapshot of approved memes and decisions to OneDrive\SmilerBackups (runs in its own window).
start "Smiler backup" /min "%NODE%" "%ROOT%server\scripts\backup.js"
if /i not "%~1"=="--no-open" start "" http://localhost:5173
endlocal
