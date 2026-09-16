@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   重新生成 WordMaster 安装包
echo ============================================================
echo.
echo 说明：安装包用 electron-builder + NSIS 打包。
echo       它需要启动子进程来给卸载程序做签名，所以在某些
echo       受限的运行环境里会失败（报 spawn UNKNOWN）。
echo       在一个普通的命令行窗口里双击本文件即可正常打包。
echo.

set CSC_IDENTITY_AUTO_DISCOVERY=false

if not exist node_modules (
  echo [1/2] 先安装依赖...
  call npm.cmd install || goto :fail
)

echo [2/2] 开始打包（约 1~3 分钟）...
call npm.cmd run build:installer || goto :fail

echo.
echo 打包完成：
echo   release\installer\WordMaster-Setup-1.0.0.exe
echo.
pause
exit /b 0

:fail
echo.
echo 打包失败，请把上面的错误信息截图反馈。
echo.
pause
exit /b 1
