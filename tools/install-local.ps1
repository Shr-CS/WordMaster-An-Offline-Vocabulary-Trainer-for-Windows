<#
  把「绿色版」正式安装到本机 —— 做的是安装包本来该做的事：
    · 复制程序到 %LOCALAPPDATA%\Programs\WordMaster
    · 创建桌面快捷方式 + 开始菜单快捷方式
    · 在「设置 → 应用 → 已安装的应用」里登记，可正常卸载

  为什么不用 electron-builder 打 NSIS 安装包：
    这台机器开着 Smart App Control（HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy
    的 VerifiedAndReputablePolicyState = 1），它只放行有数字签名或有信誉的 exe。
    NSIS 刚编译出来的安装包没有签名，Code Integrity 会直接拒绝加载
    （事件 3033/3077：did not meet the Enterprise signing level requirements），
    于是 electron-builder 卡在「运行中间安装包以提取卸载程序」这一步，
    报 spawn UNKNOWN；就算硬编出来，双击也一样打不开。
    绿色版复用的是有信誉的 electron.exe，可以正常启动，所以走这条路。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-local.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-local.ps1 -Uninstall
#>
param(
  [string]$Dest = (Join-Path $env:LOCALAPPDATA 'Programs\WordMaster'),
  [string]$AppName = '背单词 WordMaster',
  [string]$RegKey = 'WordMaster',
  [switch]$Uninstall,
  [switch]$SkipShortcuts,
  [switch]$SkipRegistry
)

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $PSScriptRoot
$SrcDir    = Join-Path $Root 'release\WordMaster'
$ExeName   = '背单词 WordMaster.exe'
$SrcExe    = Join-Path $SrcDir $ExeName
$DestExe   = Join-Path $Dest $ExeName
$Desktop   = [Environment]::GetFolderPath('Desktop')
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$RegPath   = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKey"
$UninstBat = Join-Path $Dest 'uninstall.bat'

function Write-Step($text) { Write-Host "  $text" }

function New-Shortcut($linkPath, $targetPath, $workDir) {
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($linkPath)
  $sc.TargetPath       = $targetPath
  $sc.WorkingDirectory = $workDir
  $sc.IconLocation     = "$targetPath,0"
  $sc.Description      = $AppName
  $sc.Save()
}

function Remove-Shortcuts {
  $found = 0
  $lnk = Join-Path $Desktop "$AppName.lnk"
  if (Test-Path $lnk) { Remove-Item $lnk -Force; $found++ }
  $startDir = Join-Path $StartMenu $AppName
  if (Test-Path $startDir) { Remove-Item $startDir -Recurse -Force; $found++ }
  return $found
}

# ------------------------------------------------------------------ 卸载
if ($Uninstall) {
  Write-Host '正在卸载 WordMaster ...' -ForegroundColor Cyan
  Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExeName)) -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 600

  $n = Remove-Shortcuts
  Write-Step "已移除快捷方式 $n 处"
  if (Test-Path $RegPath) { Remove-Item $RegPath -Recurse -Force; Write-Step '已移除「应用和功能」里的登记' }

  if (Test-Path $Dest) {
    try {
      Remove-Item $Dest -Recurse -Force -ErrorAction Stop
      Write-Step "已删除程序目录 $Dest"
    } catch {
      # 自己正在这个目录里跑（uninstall.bat 从里面调用）——交给一个延迟进程删
      Write-Step '程序目录正被占用，已安排稍后自动删除'
      Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-Command',
        "Start-Sleep -Seconds 3; Remove-Item -LiteralPath '$Dest' -Recurse -Force -ErrorAction SilentlyContinue"
      ) | Out-Null
    }
  } else {
    Write-Step '程序目录不存在，跳过'
  }
  Write-Host ''
  Write-Host '卸载完成。学习记录仍保留在 %APPDATA%\WordMaster，需要清空请在应用里「设置 → 清空数据」。' -ForegroundColor Green
  exit 0
}

# ------------------------------------------------------------------ 安装
Write-Host '正在安装 WordMaster ...' -ForegroundColor Cyan

if (-not (Test-Path $SrcExe)) {
  Write-Host "找不到绿色版主程序：$SrcExe" -ForegroundColor Red
  Write-Host '请先在项目目录执行：npm run build:portable' -ForegroundColor Yellow
  exit 1
}

$version = '1.0.0'
$pkg = Join-Path $Root 'package.json'
if (Test-Path $pkg) {
  try { $version = (Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
}

# 1) 复制程序
if (Test-Path $Dest) { Write-Step "目标目录已存在，覆盖：$Dest" } else { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
$robo = Get-Command robocopy.exe -ErrorAction SilentlyContinue
if ($robo) {
  & robocopy.exe $SrcDir $Dest /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 复制失败，退出码 $LASTEXITCODE" }
} else {
  Copy-Item -Path (Join-Path $SrcDir '*') -Destination $Dest -Recurse -Force
}
Write-Step "程序已复制到 $Dest"

# 2) 快捷方式
if (-not $SkipShortcuts) {
  New-Shortcut (Join-Path $Desktop "$AppName.lnk") $DestExe $Dest
  $startDir = Join-Path $StartMenu $AppName
  New-Item -ItemType Directory -Path $startDir -Force | Out-Null
  New-Shortcut (Join-Path $startDir "$AppName.lnk") $DestExe $Dest
  Write-Step '已创建桌面快捷方式与开始菜单快捷方式'
}

# 3) 卸载脚本 + 注册表登记
$uninstLines = @(
  '@echo off',
  'chcp 65001 >nul',
  "taskkill /f /im `"$ExeName`" >nul 2>&1",
  "reg delete `"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKey`" /f >nul 2>&1",
  "del /f /q `"%USERPROFILE%\Desktop\$AppName.lnk`" >nul 2>&1",
  "rmdir /s /q `"%APPDATA%\Microsoft\Windows\Start Menu\Programs\$AppName`" >nul 2>&1",
  'echo WordMaster 已卸载，学习记录仍保留在 %APPDATA%\WordMaster',
  'powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Remove-Item -LiteralPath ''%~dp0.'' -Recurse -Force -ErrorAction SilentlyContinue"',
  ''
)
Set-Content -Path $UninstBat -Value ($uninstLines -join "`r`n") -Encoding UTF8
Write-Step "已生成卸载脚本 $UninstBat"

if (-not $SkipRegistry) {
  New-Item -Path $RegPath -Force | Out-Null
  $sizeKb = [int](((Get-ChildItem $Dest -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum) / 1KB)
  Set-ItemProperty -Path $RegPath -Name 'DisplayName'     -Value $AppName
  Set-ItemProperty -Path $RegPath -Name 'DisplayVersion'  -Value $version
  Set-ItemProperty -Path $RegPath -Name 'Publisher'       -Value 'Shr-CS'
  Set-ItemProperty -Path $RegPath -Name 'DisplayIcon'     -Value "$DestExe,0"
  Set-ItemProperty -Path $RegPath -Name 'InstallLocation' -Value $Dest
  Set-ItemProperty -Path $RegPath -Name 'UninstallString' -Value "`"$UninstBat`""
  Set-ItemProperty -Path $RegPath -Name 'QuietUninstallString' -Value "`"$UninstBat`""
  Set-ItemProperty -Path $RegPath -Name 'NoModify'        -Value 1 -Type DWord
  Set-ItemProperty -Path $RegPath -Name 'NoRepair'        -Value 1 -Type DWord
  if ($sizeKb -gt 0) { Set-ItemProperty -Path $RegPath -Name 'EstimatedSize' -Value $sizeKb -Type DWord }
  Write-Step '已登记到「设置 → 应用 → 已安装的应用」'
}

Write-Host ''
Write-Host "安装完成 ✓  v$version" -ForegroundColor Green
Write-Host "  程序目录：$Dest"
Write-Host "  入口：$DestExe"
if (-not $SkipShortcuts) { Write-Host "  桌面快捷方式：$(Join-Path $Desktop "$AppName.lnk")" }
Write-Host '  卸载：用「设置 → 应用」，或双击桌面快捷方式所在目录里的 uninstall.bat'
Write-Host '  学习记录在 %APPDATA%\WordMaster，卸载不会删除。'
