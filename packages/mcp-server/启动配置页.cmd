@echo off
chcp 65001 >nul
title 词林 · 配置页
cd /d "%~dp0"
echo.
echo   正在启动配置页，稍等两秒，浏览器会自动打开。
echo   用完关掉这个黑窗口即可（配置已经存好了，不影响客户端）。
echo.
node "%~dp0tools\setup.mjs"
pause
