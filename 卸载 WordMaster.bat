@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   卸载 WordMaster
echo ============================================================
echo.
echo 会删除程序目录、桌面快捷方式、开始菜单快捷方式和安装登记。
echo 学习记录（%APPDATA%\WordMaster）会保留，需要清空请用应用里的
echo 「设置 - 清空数据」。
echo.
set /p CONFIRM=确定要卸载吗？(Y/N)
if /i not "%CONFIRM%"=="Y" (
  echo 已取消。
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-local.ps1" -Uninstall %*
set RC=%ERRORLEVEL%

echo.
pause
exit /b %RC%
