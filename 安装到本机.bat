@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   安装 WordMaster 到本机
echo ============================================================
echo.
echo 会做三件事：
echo   1. 把程序复制到  %LOCALAPPDATA%\Programs\WordMaster
echo   2. 创建桌面快捷方式和开始菜单快捷方式
echo   3. 在「设置 - 应用 - 已安装的应用」里登记，可正常卸载
echo.
echo 学习记录保存在 %APPDATA%\WordMaster，卸载时不会删除。
echo.

if not exist "release\WordMaster\背单词 WordMaster.exe" (
  echo [错误] 找不到 release\WordMaster\背单词 WordMaster.exe
  echo        请先在项目目录执行：npm run build:portable
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-local.ps1" %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (echo 安装完成。) else (echo 安装失败，错误码 %RC%。)
pause
exit /b %RC%
