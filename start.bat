@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Fix the errors above and try again.
    pause
    exit /b 1
  )
)

echo Starting Colonial Conquest dev server...
echo A browser tab will open automatically. Press Ctrl+C here to stop.
call npm start

pause
