@echo off
REM ============================================================================
REM  RSP dev launcher — starts the backend and frontend together.
REM  Double-click this file, or run  dev.bat  from a terminal.
REM
REM  Opens TWO windows:
REM    - "RSP Backend"  : FastAPI (uvicorn) with --reload on http://localhost:8000
REM    - "RSP Frontend" : Vite dev server on http://localhost:5173
REM
REM  Stop everything: close both windows (or press Ctrl+C in each).
REM  Note: keep this file in the rsp\ folder (next to backend\, frontend\, venv\).
REM ============================================================================
setlocal
set "ROOT=%~dp0"

echo.
echo   Starting RSP...
echo     backend  -^> http://localhost:8000   (docs: /docs)
echo     frontend -^> http://localhost:5173/v3.html  (opens automatically)
echo.

REM --- Backend: activate the venv, then run uvicorn with auto-reload ---
start "RSP Backend :8000" cmd /k "cd /d %ROOT%backend && call %ROOT%venv\Scripts\activate.bat && uvicorn app.main:app --reload --port 8000"

REM --- Frontend: Vite dev server (proxies /api to the backend on :8000).
REM     --open /v3.html launches the browser at the responsive v3 app once ready.
REM     --host binds all interfaces so a PHONE on the same Wi-Fi can browse it too —
REM     Vite prints a "Network: http://<your-ip>:5173" line; open that on the phone. ---
start "RSP Frontend :5173" cmd /k "cd /d %ROOT%frontend && npm run dev -- --host --open /v3.html"

echo   Two windows opened. This launcher window can be closed.
echo.
endlocal
