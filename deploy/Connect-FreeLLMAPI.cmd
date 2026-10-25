@echo off
title OpenDots FreeLLMAPI - One Click Connect
echo Starting the private FreeLLMAPI connection to OpenDots...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-FreeLLMAPI-Bridge.ps1"
echo.
echo If there is an error, check the message above.
pause
