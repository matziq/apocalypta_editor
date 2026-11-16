@echo off
setlocal
if not exist "%~dp0native_gui.py" (
    echo Apocalypter Save Editor: native_gui.py is missing next to this launcher. Restore the editor files and try again. >&2
    set "RESULT=1"
    goto :failed
)
where py >nul 2>nul
if errorlevel 1 goto :try_python
call py -3.12 -c "import sys" >nul 2>nul
if not errorlevel 1 (
    call py -3.12 "%~dp0native_gui.py" %*
    goto :check_result
)
call py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
    call py -3 "%~dp0native_gui.py" %*
    goto :check_result
)
:try_python
where python >nul 2>nul
if errorlevel 1 (
    echo Apocalypter Save Editor: Python was not found. Install Python with Tk and try again. >&2
    set "RESULT=1"
    goto :failed
)
call python "%~dp0native_gui.py" %*
:check_result
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" exit /b 0
echo Apocalypter Save Editor: source launch failed with exit code %RESULT%. >&2
:failed
echo Review the error above, then press any key to close this window.
pause >nul
exit /b %RESULT%
