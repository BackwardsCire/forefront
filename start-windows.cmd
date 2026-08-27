@echo off
REM Double-click this file on Windows to run Forefront on its localhost origin,
REM which is the setup every browser supports. Closing this window stops the
REM local server; Forefront keeps working until you close the tab, and your data
REM is already saved.
cd /d "%~dp0"
title Forefront

where node >nul 2>nul
if %errorlevel%==0 (
  node tools\serve.js --open
  exit /b
)

REM The Python launcher, then plain python. On Windows "python" is often a
REM Microsoft Store stub that opens the Store instead of running anything, so
REM "py -3" is tried first.
py -3 -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8765/
  py -3 -m http.server 8765 --bind 127.0.0.1
  exit /b
)

python -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8765/
  python -m http.server 8765 --bind 127.0.0.1
  exit /b
)

echo.
echo Forefront needs Node.js or Python 3 to serve itself to your browser.
echo Install either one, then double-click this file again:
echo.
echo     Node.js    https://nodejs.org
echo     Python 3   https://www.python.org/downloads/
echo.
pause
