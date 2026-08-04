@echo off
setlocal

cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Error: Node.js and npm were not found in PATH.
    echo Install Node.js, then run this file again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing project dependencies...
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo Error: Dependency installation failed.
        pause
        exit /b 1
    )
)

echo Starting the IFC Cost development server...
echo Press Ctrl+C to stop it.
echo.
call npm.cmd run dev -- --host 127.0.0.1 --open

echo.
echo Server stopped.
pause

endlocal
