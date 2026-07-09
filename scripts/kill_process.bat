netstat -ano | findstr :8080
taskkill /PID 12345 /F

@echo off
setlocal enabledelayedexpansion

:: Check if parameter is provided
if "%~1"=="" (
    echo [ERROR] Please provide a port number.
    echo Usage: %~0 ^<port_number^>
    exit /b 1
)

set "PORT=%~1"
set "PID="

echo Searching for process on port !PORT!...

:: Find the PID listening on the specified port
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
    set "PID=%%A"
)

:: Kill the process if found
if not "!PID!"=="" (
    echo Found process with PID !PID! on port !PORT!. Terminating...
    taskkill /PID !PID! /F
    if !errorlevel! equ 0 (
        echo [SUCCESS] Process on port !PORT! has been killed.
    ) else (
        echo [ERROR] Failed to kill process. Try running this script as Administrator.
    )
) else (
    echo [INFO] No active process found listening on port !PORT!.
)

endlocal
