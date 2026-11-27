@echo off
setlocal
if not exist "%~dp0native_gui.py" (
    echo Apocalypta Editor: native_gui.py is missing next to this launcher. Restore the editor files and try again. >&2
    exit /b 1
)
set "PYTHON="
call py -3.12 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PYTHON=py -3.12"
if not defined PYTHON (
    call py -3 -c "import sys" >nul 2>nul
    if not errorlevel 1 set "PYTHON=py -3"
)
if not defined PYTHON (
    where python >nul 2>nul
    if not errorlevel 1 set "PYTHON=python"
)
if not defined PYTHON (
    echo Apocalypta Editor: Python 3 was not found. Install Python 3.12 or newer and try again. >&2
    exit /b 1
)
call %PYTHON% "%~dp0native_gui.py" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo Apocalypta Editor: the application exited with exit code %RESULT%. >&2
    echo press any key to close this window.
    pause
    echo exit code %RESULT% >&2
)
exit /b %RESULT%
