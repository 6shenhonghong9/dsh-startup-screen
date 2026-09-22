@echo off
chcp 65001 >nul
setlocal

set "HERE=%~dp0"
set "PAGE=%HERE%preview\index.html"

if not exist "%PAGE%" (
  echo [x] 找不到预览页: %PAGE%
  pause
  exit /b 1
)

echo.
echo   dsh-startup-screen - 启动动画离线预览
echo   ------------------------------------------------
echo   预览页: %PAGE%
echo.
echo   打开后:
echo     1) 自动播放一遍完整的启动动画
echo     2) 右上角控制台可改身份名称 / 权限等级 / 主题 / 速度
echo     3) 第 1、2 步需要你点按钮或按 Enter 才会继续
echo     4) 右上角 SKIP 或 Esc 可跳过; 点「设置面板预览」看 DSH 设置页里的样子
echo.

start "" "%PAGE%"
exit /b 0
