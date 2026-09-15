'use strict';

/**
 * 预加载脚本：在隔离上下文里只暴露一组明确的白名单能力给页面。
 * 页面拿不到 Node，只能调用这里列出的方法。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /** 切换系统标题栏配色，与应用内黑白主题保持一致 */
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  /** 读取版本与路径信息（设置页展示用） */
  getInfo: () => ipcRenderer.invoke('app:info'),

  /** 把 JSON 字符串存成文件（弹出系统保存对话框） */
  exportData: (json) => ipcRenderer.invoke('data:export', json),

  /** 选择并读取一个备份文件 */
  importData: () => ipcRenderer.invoke('data:import'),

  /** 主进程菜单触发的导入导出 */
  onMenu: (channel, handler) => {
    const allowed = ['menu:export', 'menu:import'];
    if (!allowed.includes(channel)) return () => {};
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
