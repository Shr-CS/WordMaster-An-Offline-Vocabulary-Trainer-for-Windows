'use strict';

/**
 * build-portable.js — 生成免安装的绿色版程序
 *
 * 原理：把 Electron 运行时整份复制出来，再把本应用塞进 resources/app，
 * 最后把 electron.exe 改名为「背单词 WordMaster.exe」。
 * 全程不需要联网，也不依赖 electron-builder 等额外工具。
 *
 * 用法：node tools/build-portable.js
 * 产物：release/WordMaster/背单词 WordMaster.exe
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const RELEASE = path.join(ROOT, 'release');
const OUT = path.join(RELEASE, 'WordMaster');
const APP_NAME = '背单词 WordMaster';

const APP_FILES = ['main.js', 'preload.js', 'package.json'];
const APP_DIRS = ['src', 'tools'];
const VERSION = require(path.join(ROOT, 'package.json')).version;

const EXCLUDE = new Set(['node_modules', 'release', '.git']);
/** 不需要塞进程序里的目录（截图、图标源文件等） */
const APP_EXCLUDE_DIRS = new Set(['shots']);

let copiedFiles = 0;
let copiedBytes = 0;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (APP_EXCLUDE_DIRS.has(entry.name)) continue;
      copyDir(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      copiedFiles += 1;
      copiedBytes += fs.statSync(dst).size;
    }
  }
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('找不到 Electron 运行时：' + DIST);
    console.error('请先在项目目录执行：npm install');
    process.exit(1);
  }

  console.log('清理旧产物…');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log('复制 Electron 运行时…');
  copyDir(DIST, OUT);

  // 默认示例应用不需要
  const defaultApp = path.join(OUT, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp, { force: true });

  console.log('打包应用源码…');
  const appDir = path.join(OUT, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of APP_FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) throw new Error('缺少文件：' + file);
    fs.copyFileSync(src, path.join(appDir, file));
  }
  for (const dir of APP_DIRS) {
    const src = path.join(ROOT, dir);
    if (fs.existsSync(src)) copyDir(src, path.join(appDir, dir));
  }
  // 窗口/任务栏图标
  const iconSrc = path.join(ROOT, 'build', 'icon.png');
  if (fs.existsSync(iconSrc)) {
    fs.mkdirSync(path.join(appDir, 'build'), { recursive: true });
    fs.copyFileSync(iconSrc, path.join(appDir, 'build', 'icon.png'));
    fs.copyFileSync(iconSrc, path.join(OUT, 'icon.png'));
  }

  console.log('重命名可执行文件…');
  const exeSrc = path.join(OUT, 'electron.exe');
  const exeDst = path.join(OUT, `${APP_NAME}.exe`);
  if (!fs.existsSync(exeSrc)) throw new Error('找不到 electron.exe');
  fs.renameSync(exeSrc, exeDst);

  // 双击即可创建桌面快捷方式
  // 拆成 .bat + .ps1 两个文件，避免在 cmd 里嵌套引号转义（那是最容易出错的地方）
  const batLines = [
    '@echo off',
    'chcp 65001 >nul',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"',
    'pause',
    '',
  ];
  fs.writeFileSync(path.join(OUT, '创建桌面快捷方式.bat'), batLines.join('\r\n'), 'utf8');

  const psLines = [
    "$ErrorActionPreference = 'Stop'",
    `$exe = Join-Path $PSScriptRoot '${APP_NAME}.exe'`,
    "if (-not (Test-Path $exe)) { Write-Host '找不到主程序，请确认本文件与 exe 在同一目录'; exit 1 }",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$lnk = Join-Path $desktop '${APP_NAME}.lnk'`,
    '$ws = New-Object -ComObject WScript.Shell',
    '$sc = $ws.CreateShortcut($lnk)',
    '$sc.TargetPath = $exe',
    '$sc.WorkingDirectory = $PSScriptRoot',
    '$sc.IconLocation = "$exe,0"',
    '$sc.Description = "背单词 WordMaster"',
    '$sc.Save()',
    'Write-Host ""',
    'Write-Host "已创建桌面快捷方式：$lnk" -ForegroundColor Green',
    '',
  ];
  // Windows PowerShell 5.1 读 UTF-8 需要 BOM，否则中文会乱码
  fs.writeFileSync(path.join(OUT, 'create-shortcut.ps1'), '\uFEFF' + psLines.join('\r\n'), 'utf8');

  const readme = [
    `${APP_NAME} v${VERSION} —— 免安装绿色版`,
    '='.repeat(46),
    '',
    '【怎么用】',
    `  1. 双击「${APP_NAME}.exe」直接运行，无需安装。`,
    '  2. 想放到桌面：双击「创建桌面快捷方式.bat」。',
    '  3. 整个文件夹可以拷到 U 盘或别的电脑，程序和数据互不影响。',
    '',
    '【数据存在哪】',
    '  学习记录保存在  %APPDATA%\\WordMaster\\',
    '  换电脑时在「设置 → 数据管理」里导出备份，另一台导入即可继续。',
    '',
    '【内置词库】',
    '  小学 200 / 初中 220 / 高中 240 / 四级 250 / 六级 250 / 雅思 250 / 托福 250',
    '  合计 1660 词，全部离线内置，无需联网。',
    '',
    '【主要功能】',
    '  · 7 个词库等级可自由多选组合',
    '  · 英译中 / 中译英 / 中英混合三种出题方向',
    '  · 每天背诵数量可调（5~200）',
    '  · 答对、答错各有一套音效；英文可用系统语音朗读',
    '  · 白色 / 黑色主题一键切换',
    '  · 今天学的新词，明天自动进入复习；答对间隔 1→2→4→7→15→30 天',
    '',
    '【快捷键】',
    '  1~4 或 A~D  选择答案     Enter / 空格  继续',
    '  S          朗读单词     Esc          退出学习',
    '  Ctrl+E     导出备份     Ctrl+I       导入备份',
    '  F11        全屏         F12          开发者工具',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(OUT, '使用说明.txt'), readme, 'utf8');

  const total = fs.readdirSync(OUT).length;
  console.log('');
  console.log('打包完成 ✓');
  console.log(`  目录：${path.relative(ROOT, OUT)}`);
  console.log(`  入口：${path.relative(ROOT, exeDst)}`);
  console.log(`  资源：复制 ${copiedFiles} 个文件（${(copiedBytes / 1024).toFixed(0)} KB），顶层 ${total} 项`);
}

main();
