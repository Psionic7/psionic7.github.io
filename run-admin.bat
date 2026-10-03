@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-admin.ps1" %*
exit /b %ERRORLEVEL%
