/* ============================================================================
   app.js — 应用引导层
   负责：初始化、主题切换、导航路由、顶栏/侧栏状态同步、数据导入导出、
         跨天检测、全局快捷键、与 Electron 主进程通信。
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const { mount, toast, confirmDialog, dayStr, h, icon } = WM.util;
  const store = WM.store;
  const bank = WM.bank;
  const sound = WM.sound;
  const views = WM.views;
  const study = WM.study;

  const app = {
    route: 'home',
    info: null,
    lastDay: null,
  };

  const viewEl = () => document.getElementById('view');

  /* ============================== 主题 ============================== */

  function setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    // 让系统标题栏按钮配色跟着走（Electron 环境）
    if (window.desktop && window.desktop.setTheme) {
      window.desktop.setTheme(next).catch(() => {});
    }
    const btn = document.getElementById('btn-theme');
    if (btn) {
      btn.title = next === 'dark' ? '切换到白色主题' : '切换到黑色主题';
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', next === 'dark' ? '#i-sun' : '#i-moon');
    }
  }

  function toggleTheme() {
    const next = store.get().settings.theme === 'dark' ? 'light' : 'dark';
    views.applySettings({ theme: next });
    toast(next === 'dark' ? '已切换到黑色主题' : '已切换到白色主题', 'ok', 1500);
  }

  /* ============================== 顶栏 / 侧栏 ============================== */

  function refreshChrome() {
    const state = store.get();
    if (!bank.dataReady()) return;

    const prog = bank.planProgress(state);

    const streakEl = document.getElementById('streak-days');
    if (streakEl) streakEl.textContent = String(state.streak.current || 0);

    const badgeNew = document.getElementById('badge-new');
    if (badgeNew) {
      badgeNew.textContent = String(prog.newLeft);
      badgeNew.classList.toggle('show', prog.newLeft > 0);
    }
    const badgeReview = document.getElementById('badge-review');
    if (badgeReview) {
      badgeReview.textContent = String(prog.reviewLeft);
      badgeReview.classList.toggle('show', prog.reviewLeft > 0);
    }

    const chips = document.getElementById('scope-chips');
    if (chips) {
      mount(chips, bank.levels().map((lv) => h('span', {
        class: `chip ${state.settings.levels.includes(lv.id) ? 'on' : 'muted'}`,
        title: lv.desc,
        text: lv.name,
      })));
    }

    const center = document.getElementById('titlebar-center');
    if (center) {
      const names = state.settings.levels.map((id) => bank.levelMeta(id).name).join('/') || '全部';
      const dirText = { en2zh: '英译中', zh2en: '中译英', mixed: '中英混合' }[state.settings.direction] || '';
      center.textContent = `今日剩余 ${prog.totalLeft} 题（新词 ${prog.newLeft} · 复习 ${prog.reviewLeft}） · 范围 ${names} · ${dirText}`;
    }

    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn) {
      const on = state.settings.sound;
      soundBtn.classList.toggle('is-off', !on);
      soundBtn.title = on ? '关闭音效' : '开启音效';
      const use = soundBtn.querySelector('use');
      if (use) use.setAttribute('href', on ? '#i-volume' : '#i-mute');
    }

    document.querySelectorAll('.nav-item').forEach((node) => {
      node.classList.toggle('active', node.dataset.route === app.route);
    });
  }

  /* ============================== 路由 ============================== */

  function render(route) {
    const view = viewEl();
    view.scrollTop = 0;
    switch (route) {
      case 'wordbook': views.renderWordbook(view); break;
      case 'stats': views.renderStats(view); break;
      case 'settings': views.renderSettings(view); break;
      default:
        app.route = 'home';
        views.renderHome(view);
    }
    refreshChrome();
  }

  function go(route) {
    app.route = route;
    render(route);
  }

  function startStudy(kind) {
    app.route = kind === 'review' ? 'review' : 'study';
    refreshChrome();
    const ok = study.start(kind);
    if (!ok) {
      app.route = 'home';
      render('home');
    }
  }

  /** 学习结束后回到首页 */
  function resume() {
    app.route = 'home';
    render('home');
  }

  async function navigate(route) {
    if (study.isActive() && route !== 'study' && route !== 'review') {
      const ok = await confirmDialog({
        title: '离开当前学习？',
        message: '本次已作答的记录已经保存，离开不会丢失成绩。',
        okText: '离开',
        cancelText: '继续学习',
        danger: true,
      });
      if (!ok) return;
      study.destroy();
    }
    if (route === 'study' || route === 'review') {
      if (study.isActive()) {
        study.renderInto();
        return;
      }
      startStudy(route === 'review' ? 'review' : 'mixed');
      return;
    }
    go(route);
    sound.swish();
  }

  /* ============================== 数据导入导出 ============================== */

  async function exportData() {
    const json = store.exportJSON();
    if (window.desktop && window.desktop.exportData) {
      const res = await window.desktop.exportData(json);
      if (res && res.ok) toast('备份已保存到：' + res.filePath, 'ok', 4000);
      else if (res && res.reason !== 'canceled') toast('导出失败', 'err');
      return;
    }
    // 浏览器回退方案
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WordMaster-备份-${dayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('备份文件已下载', 'ok');
    } catch (err) {
      toast('导出失败：' + err.message, 'err');
    }
  }

  async function importData() {
    if (window.desktop && window.desktop.importData) {
      const res = await window.desktop.importData();
      if (!res || !res.ok) {
        if (res && res.reason !== 'canceled') toast('导入失败', 'err');
        return;
      }
      await applyImport(res.text);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      await applyImport(await file.text());
    };
    input.click();
  }

  async function applyImport(text) {
    const ok = await confirmDialog({
      title: '导入学习数据？',
      message: '导入会覆盖当前全部学习记录。建议先导出一次备份。',
      okText: '确认导入',
      danger: true,
    });
    if (!ok) return;
    const result = store.importJSON(text);
    if (!result.ok) {
      toast('导入失败：' + result.message, 'err', 3600);
      return;
    }
    setTheme(store.get().settings.theme);
    sound.setEnabled(store.get().settings.sound);
    sound.setVolume(store.get().settings.volume);
    bank.ensurePlan(store.get(), { rebuild: true });
    store.flush();
    toast(result.message, 'ok', 3200);
    go('home');
  }

  /* ============================== 小工具 ============================== */

  function speakRandomWord() {
    const state = store.get();
    const learned = Object.values(state.words);
    const pool = learned.length ? learned : bank.poolFor(state.settings.levels);
    if (!pool.length) {
      toast('还没有可朗读的单词', 'warn');
      return;
    }
    const word = WM.util.pick(pool);
    sound.speak(word.en);
    toast(`听写：${word.en}`, 'ok', 2600);
  }

  /* ============================== 跨天检测 ============================== */

  function checkDayRollover() {
    const today = dayStr();
    if (app.lastDay && app.lastDay !== today) {
      const state = store.get();
      bank.ensurePlan(state, { rebuild: true });
      store.save();
      const prog = bank.planProgress(state);
      toast(`新的一天开始了，今天有 ${prog.reviewLeft} 个单词需要复习`, 'ok', 5200);
      sound.finish();
      if (!study.isActive()) render(app.route);
      else refreshChrome();
    }
    app.lastDay = today;
  }

  /* ============================== 初始化 ============================== */

  function bindChrome() {
    document.querySelectorAll('.nav-item').forEach((node) => {
      node.addEventListener('click', () => navigate(node.dataset.route));
    });

    document.getElementById('btn-theme').addEventListener('click', toggleTheme);

    document.getElementById('btn-sound').addEventListener('click', () => {
      const next = !store.get().settings.sound;
      views.applySettings({ sound: next });
      if (next) sound.click();
      toast(next ? '音效已开启' : '音效已静音', 'ok', 1400);
    });

    document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));

    // 全局快捷键
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'e') {
          event.preventDefault();
          exportData();
        } else if (event.key.toLowerCase() === 'i') {
          event.preventDefault();
          importData();
        }
        return;
      }
      if (event.altKey) return;

      if (study.isActive()) return; // 学习页有自己的快捷键

      const key = event.key.toLowerCase();
      if (key === '1') navigate('home');
      else if (key === '2') navigate('study');
      else if (key === '3') navigate('review');
      else if (key === '4') navigate('wordbook');
      else if (key === '5') navigate('stats');
      else if (key === '6') navigate('settings');
    });

    // 退出前立即落盘
    window.addEventListener('beforeunload', () => store.flush());
    window.addEventListener('blur', () => store.flush());

    // 主进程菜单触发的导入导出
    if (window.desktop && window.desktop.onMenu) {
      window.desktop.onMenu('menu:export', exportData);
      window.desktop.onMenu('menu:import', importData);
    }
  }

  function fatal(message, detail) {
    const view = viewEl();
    mount(view, h('div', { class: 'empty', style: { paddingTop: '18vh' } },
      icon('i-bolt'),
      h('b', { text: message }),
      h('p', { text: detail })));
  }

  async function init() {
    // 1) 读取本地数据
    const state = store.load();

    // 2) 应用主题与音效
    setTheme(state.settings.theme);
    sound.setEnabled(state.settings.sound);
    sound.setVolume(state.settings.volume);

    // 3) 词库自检
    if (!bank.dataReady()) {
      fatal('没有加载到词库数据', '请确认 src/data/words.js 存在。可在项目目录执行：node tools/build-data.js');
      return;
    }

    // 4) 生成今天的计划
    bank.ensurePlan(state, { rebuild: true });
    store.save();

    // 5) 绑定界面事件
    bindChrome();

    // 6) 读取运行环境信息（Electron 提供）
    if (window.desktop && window.desktop.getInfo) {
      try {
        app.info = await window.desktop.getInfo();
      } catch {
        app.info = null;
      }
    }

    // 7) 首屏
    app.lastDay = dayStr();
    go('home');

    // 8) 跨天检测 + 定时落盘
    setInterval(checkDayRollover, 45000);
    window.addEventListener('focus', checkDayRollover);
    setInterval(() => store.flush(), 30000);

    // 9) 欢迎提示：有复习任务时提醒
    const prog = bank.planProgress(state);
    if (prog.reviewLeft > 0) {
      setTimeout(() => {
        toast(`今天有 ${prog.reviewLeft} 个单词到期，建议先复习`, 'warn', 4200);
      }, 700);
    }
  }

  /* ============================== 对外接口 ============================== */

  app.setTheme = setTheme;
  app.toggleTheme = toggleTheme;
  app.refreshChrome = refreshChrome;
  app.go = go;
  app.navigate = navigate;
  app.startStudy = startStudy;
  app.resume = resume;
  app.exportData = exportData;
  app.importData = importData;
  app.speakRandomWord = speakRandomWord;

  WM.app = app;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.WM);
