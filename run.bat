@echo off
setlocal
if not exist "%~dp0launcher.ps1" (
    echo Apocalypter Save Editor: launcher.ps1 is missing next to this launcher. Restore the editor files and try again. >&2
    exit /b 1
)
if not exist "%~dp0index.html" (
    echo Apocalypter Save Editor: index.html is missing next to this launcher. Restore the editor files and try again. >&2
    exit /b 1
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" %*
if errorlevel 1 (
    echo Apocalypter Save Editor: the native save picker bridge failed. See the error above. >&2
    echo You can still open index.html directly and use its browser file chooser. >&2
    pause
    exit /b 1
)
exit /b 0
