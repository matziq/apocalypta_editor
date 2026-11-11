@echo off
setlocal
if not exist "%~dp0index.html" (
    echo Apocalypter Save Editor: index.html is missing next to this launcher. Restore the editor files and try again. >&2
    exit /b 1
)
start "" "%~dp0index.html"
if errorlevel 1 (
    echo Apocalypter Save Editor: could not open index.html. Check the default application for HTML files. >&2
    exit /b 1
)
exit /b 0
