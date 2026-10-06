@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

REM ============================================================================
REM  dsh-startup-screen 安装脚本
REM  ---------------------------------------------------------------------------
REM  同时支持两种 DSH：
REM    web     —— `npm i -g @deepseek-ai/dsh` 起的 dsh web 服务（web profile）
REM    desktop —— DeepSeek Harness Desktop 桌面端（desktop profile，由 Electron 托管）
REM
REM  桌面端注意：安装前请**完全退出**桌面端，装完再打开。
REM  （desktop profile 的 package.json 由桌面端进程加锁管理，进程在跑时装不进去）
REM ============================================================================

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

echo.
echo ============================================================
echo   dsh-startup-screen 安装
echo ============================================================
echo   包目录：%HERE%
echo.

REM ── 1. 找 dsh ──────────────────────────────────────────────────────────────
where dsh >nul 2>nul
if errorlevel 1 goto no_dsh

REM ── 2. 找包 ────────────────────────────────────────────────────────────────
set "PKG="
if exist "%HERE%\package.json" (
  set "PKG=%HERE%"
) else if exist "%HERE%\plugin\package.json" (
  set "PKG=%HERE%\plugin"
) else (
  for %%F in ("%HERE%\*.tgz") do if not defined PKG set "PKG=%%~fF"
)
if not defined PKG goto no_pkg
echo [1/4] 待安装的包：!PKG!

REM ── 3. 检测 profile ────────────────────────────────────────────────────────
set "HAS_WEB="
set "HAS_DESKTOP="
if exist "%USERPROFILE%\.dsh\profiles\web\package.json" set "HAS_WEB=1"
if exist "%USERPROFILE%\.dsh\profiles\desktop\package.json" set "HAS_DESKTOP=1"

if defined HAS_WEB     echo [2/4] 检测到 web profile
if defined HAS_DESKTOP echo [2/4] 检测到 desktop profile（桌面端）
if not defined HAS_WEB if not defined HAS_DESKTOP (
  echo [2/4] 没有检测到已初始化的 profile
  echo        web 用户先跑一次 `dsh web`；桌面端用户先打开一次桌面端再退出。
  goto done
)

REM ── 4. 安装 ────────────────────────────────────────────────────────────────
set /a STEP=2
if defined HAS_WEB (
  set /a STEP+=1
  echo [!STEP!/4] 安装到 web profile ...
  call dsh plugin --profile web add "!PKG!"
  if errorlevel 1 (
    echo       ^> web profile 安装失败，看上面的报错。常见原因：插件已装过（先 remove）。
  ) else (
    echo       ^> web profile 安装完成
  )
)
if defined HAS_DESKTOP (
  set /a STEP+=1
  echo [!STEP!/4] 安装到 desktop profile ...
  call dsh plugin --profile desktop add "!PKG!"
  if errorlevel 1 (
    echo       ^> desktop profile 安装失败。确认桌面端已**完全退出**后再试。
  ) else (
    echo       ^> desktop profile 安装完成
  )
)

echo.
echo ============================================================
echo   装完了，接下来：
echo ============================================================
if defined HAS_WEB (
  echo   web      ：重启 dsh web（关掉启动器窗口再重新双击），刷新页面即可看到启动动画。
)
if defined HAS_DESKTOP (
  echo   desktop  ：重新打开 DeepSeek Harness Desktop，点开任意对话即可看到启动动画。
)
echo.
echo   设置页里会多出一项「启动动画」，身份名称、权限等级、配色、速度、语音都能改。
echo   卸载：dsh plugin --profile web remove dsh-startup-screen
echo         dsh plugin --profile desktop remove dsh-startup-screen
echo.
pause
exit /b 0

:no_dsh
echo [x] 找不到 dsh 命令。
echo.
echo     先装 DSH：npm i -g @deepseek-ai/dsh
echo     （桌面端用户：装一次全局 dsh 只是为了用它的 plugin 子命令，
echo       插件本身是装进桌面端的 profile，不会被 Open 桌面端用不上。）
pause
exit /b 1

:no_pkg
echo [x] 在 %HERE% 里找不到 package.json / plugin\package.json / *.tgz。
echo     把这个脚本放在解压后的插件目录根（和 package.json 同级）再跑。
pause
exit /b 1

:done
pause
exit /b 0
