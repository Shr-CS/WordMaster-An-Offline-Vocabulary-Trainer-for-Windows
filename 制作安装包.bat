@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   重新生成 WordMaster 安装包（Setup.exe）
echo ============================================================
echo.
echo 【重要】本机很可能打不出安装包，也跑不了安装包。
echo.
echo   开启 Smart App Control 的 Windows 只放行有数字签名或有信誉的 exe。
echo   electron-builder 打 NSIS 安装包时，必须先运行一个刚编译出来、
echo   没有签名的中间安装包来提取卸载程序 —— 这一步会被系统拒绝，
echo   报 spawn UNKNOWN；系统日志里能查到 Code Integrity 3033/3077：
echo     "...WordMaster-Setup-1.0.0.exe that did not meet the
echo      Enterprise signing level requirements"
echo.
echo   本机状态可以用这条命令确认：
echo     reg query "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v VerifiedAndReputablePolicyState
echo     值为 1 表示 Smart App Control 正在强制执行。
echo.
echo   替代方案：直接双击仓库根目录的「安装到本机.bat」，
echo   它把绿色版装到 %LOCALAPPDATA%\Programs\WordMaster，
echo   一样有桌面/开始菜单快捷方式和「应用和功能」里的卸载项。
echo.
echo   确实要 Setup.exe：请在另一台没有开启 Smart App Control 的
echo   Windows 上运行本脚本，或用代码签名证书给产物签名。
echo.
set /p CONFIRM=仍要尝试打包吗？(Y/N)
if /i not "%CONFIRM%"=="Y" (
  echo 已取消。
  pause
  exit /b 0
)

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
echo ------------------------------------------------------------------
echo 打包失败。如果是 spawn UNKNOWN，且上面提到了 Code Integrity /
echo Application Control，那就是 Smart App Control 拦的，不是项目的问题。
echo 请改用「安装到本机.bat」，或换一台机器打包。
echo ------------------------------------------------------------------
echo.
pause
exit /b 1
