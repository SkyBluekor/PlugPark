@echo off
setlocal
cd /d "%~dp0"
title PlugPark Local AI
npm run ai:start
if errorlevel 1 (
  echo.
  echo PlugPark AI start failed.
  pause
)
