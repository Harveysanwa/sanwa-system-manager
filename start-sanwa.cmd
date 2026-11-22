@echo off
chcp 65001 >nul
setlocal
title Sanwa系统管理器
cd /d "%~dp0"

set "PORT=%SANWA_PORT%"
if "%PORT%"=="" set "PORT=9900"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] 未找到 Node.js，请安装 Node.js 22 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo   Sanwa系统管理器 - 启动本地服务（端口 %PORT%）…
start "Sanwa系统管理器服务" /min cmd /c "node ""%~dp0server.js"""
timeout /t 3 /nobreak >nul
echo   [OK] 界面地址：http://127.0.0.1:%PORT%/
start "" "http://127.0.0.1:%PORT%/"
exit /b 0
