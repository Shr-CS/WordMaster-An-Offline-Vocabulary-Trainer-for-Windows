'use strict';

/**
 * 背单词 WordMaster — Electron 主进程
 * 负责：创建窗口、主题化的系统标题栏、原生菜单快捷键、数据导入导出。
 */

const { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// 固定应用名，使学习数据始终落在 %APPDATA%\WordMaster（纯英文路径，便于备份）
app.setName('WordMaster');

/** 标题栏覆盖层配色，跟随应用内黑白主题切换 */
const TITLEBAR = {
  dark: { color: '#12141c', symbolColor: '#c8cee0' },
  light: { color: '#ffffff', symbolColor: '#3b4257' },
};

/** @type {BrowserWindow | null} */
let mainWindow = null;

// 单实例：重复启动时聚焦已有窗口，避免两个进程抢同一份数据
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f1117',
    title: '背单词 WordMaster',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR.dark, height: 48 },
    autoHideMenuBar: true,
    ...(require('node:fs').existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 等首帧渲染完再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外链一律交给系统浏览器，绝不在应用窗口内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

/**
 * 精简原生菜单：标题栏隐藏后菜单不可见，但键盘快捷键依然生效。
 */
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '导出学习数据…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export'),
        },
        {
          label: '导入学习数据…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.send('menu:import'),
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------- IPC 接口 ------------------------------- */

ipcMain.handle('theme:set', (_event, theme) => {
  const palette = theme === 'light' ? TITLEBAR.light : TITLEBAR.dark;
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setTitleBarOverlay({ ...palette, height: 48 });
    } catch {
      /* 部分平台不支持标题栏覆盖层，忽略即可 */
    }
  }
  return true;
});

ipcMain.handle('app:info', () => ({
  name: '背单词 WordMaster',
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  userData: app.getPath('userData'),
}));

ipcMain.handle('data:export', async (_event, payload) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出学习数据',
    defaultPath: path.join(app.getPath('documents'), `WordMaster-备份-${stamp}.json`),
    filters: [{ name: 'JSON 数据文件', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };
  await fs.writeFile(filePath, payload, 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('data:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入学习数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON 数据文件', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false, reason: 'canceled' };
  const text = await fs.readFile(filePaths[0], 'utf8');
  return { ok: true, text, filePath: filePaths[0] };
});

/* ------------------------------- 生命周期 ------------------------------- */

app.whenReady().then(() => {
  app.setAppUserModelId('com.wordmaster.desktop');
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
