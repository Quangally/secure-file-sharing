@echo off
setlocal
set "SECURE_SHARE_PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%SECURE_SHARE_PYTHON%" set "SECURE_SHARE_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
if not exist "%SECURE_SHARE_PYTHON%" (
    echo Chua co Python venv. Chay tai thu muc goc:
    echo py -m venv .venv
    echo .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    exit /b 1
)
"%SECURE_SHARE_PYTHON%" "%~dp0scripts\start_backend.py" %*
exit /b %errorlevel%
