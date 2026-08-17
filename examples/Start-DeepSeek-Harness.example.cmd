@echo off
setlocal

rem Copy this file and set HARNESS_ROOT to your local Harness directory.
set "HARNESS_ROOT=C:\path\to\deepseek-harness"
set "DSH_HOME=%HARNESS_ROOT%\.dsh"

if not exist "%HARNESS_ROOT%\node_modules\.bin\dsh.cmd" (
  echo [ERROR] Harness launcher not found under %HARNESS_ROOT%
  exit /b 1
)

cd /d "%HARNESS_ROOT%"
call "%HARNESS_ROOT%\node_modules\.bin\dsh.cmd" web
exit /b %ERRORLEVEL%
