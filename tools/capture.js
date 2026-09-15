'use strict';

/**
 * capture.js — 开发期视觉 + 可交互性验证工具（不参与正式打包）
 *
 * 用 Electron 真实渲染应用，依次走完首页 / 设置 / 答题 / 反馈 / 生词本 / 统计，
 * 把每一步截图存到 build/shots/。
 *
 * 关键点：**点击一律使用真实的鼠标输入事件**（webContents.sendInputEvent），
 * 而不是 element.click()。后者会绕过命中测试，曾经因此漏掉过一个
 * 「全屏遮罩挡住所有鼠标点击」的严重 bug。
 *
 * 用法：node_modules\electron\dist\electron.exe tools\capture.js
 * 环境变量：
 *   WM_APP_DIR   指定要验证的应用目录（默认源码目录，可指向已打包的 resources/app）
 *   WM_SHOT_DIR  指定截图输出目录
 *
 * 注意：使用独立的临时 userData，不会污染正式学习数据。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT_DIR = process.env.WM_SHOT_DIR
  ? path.resolve(process.env.WM_SHOT_DIR)
  : path.join(__dirname, '..', 'build', 'shots');
const APP_DIR = process.env.WM_APP_DIR ? path.resolve(process.env.WM_APP_DIR) : path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'wordmaster-capture-profile');

// 隔离数据目录，保证截图过程不影响真实使用
// 必须先清空：否则上一次截图运行写入的 localStorage（含主题）会残留，导致深色截图拍成浅色
fs.rmSync(PROFILE, { recursive: true, force: true });
app.setPath('userData', PROFILE);

// 截图进程没有跑 main.js，这里补上渲染进程会调用的 IPC，避免日志里出现无意义的报错
ipcMain.handle('theme:set', () => true);
ipcMain.handle('app:info', () => ({
  name: '背单词 WordMaster',
  version: '1.0.0',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  userData: PROFILE,
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    show: true,
    backgroundColor: '#0e1016',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#12141c', symbolColor: '#c8cee0', height: 48 },
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const problems = [];
  win.webContents.on('console-message', (event) => {
    const level = event && typeof event === 'object' ? event.level : arguments[1];
    if (level === 'error' || level === 3) {
      problems.push('[console error] ' + (event && event.message ? event.message : '(unknown)'));
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    problems.push('render-process-gone: ' + JSON.stringify(details));
  });
  win.webContents.on('preload-error', (_e, file, error) => {
    problems.push('preload-error: ' + file + ' ' + error.message);
  });

  await win.loadFile(path.join(APP_DIR, 'src', 'index.html'));
  await sleep(1300);
  win.focus();
  win.webContents.focus();

  console.log('app dir: ' + APP_DIR);

  const js = (code) => win.webContents.executeJavaScript(code, true);
  let counter = 0;
  let regionCounter = 0;

  async function guard(label, code) {
    try {
      const result = await js(code);
      if (result === false) problems.push(`[step:${label}] returned false`);
      return result;
    } catch (err) {
      problems.push(`[step:${label}] ${err.message}`);
      return null;
    }
  }

  /* --------------------------- 截图 --------------------------- */

  async function shot(name, wait = 520) {
    await sleep(wait);
    const image = await win.webContents.capturePage();
    const file = path.join(OUT_DIR, `${String(++counter).padStart(2, '0')}-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log('shot -> ' + path.basename(file));
  }

  async function shotRegion(name, selector, wait = 420) {
    await sleep(wait);
    const rect = await elementRect(selector);
    if (!rect) {
      problems.push(`[region] 未找到元素 ${selector}`);
      return;
    }
    const image = await win.webContents.capturePage(rect);
    const file = path.join(OUT_DIR, `R${String(++regionCounter).padStart(2, '0')}-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log('region -> ' + path.basename(file));
  }

  /* ---------------------- 真实鼠标输入 ---------------------- */

  async function elementRect(selector) {
    return js(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return null;
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      })()
    `);
  }

  /**
   * 用真实鼠标事件点击元素中心。
   * 走完整的命中测试流程，被任何遮罩挡住都会点空——这正是我们要验证的。
   */
  async function realClick(selector, label) {
    const rect = await elementRect(selector);
    if (!rect) {
      problems.push(`[click] 找不到可点击元素 ${selector}`);
      return false;
    }
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(30);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
    if (label) console.log(`click -> ${label}  (${x},${y})`);
    return true;
  }

  /* --------------------- 可交互性审计 --------------------- */

  await js(`
    window.__hitAudit = function () {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 1) 找出铺满视口、且没有关闭指针事件的浮层——这类元素会吞掉全部点击
      const blockers = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.pointerEvents === 'none') continue;
        if (cs.opacity === '0') continue;
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw * 0.9 && r.height >= vh * 0.9) {
          blockers.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            cls: typeof el.className === 'string' ? el.className : '',
            z: cs.zIndex,
            bg: cs.backgroundColor,
            pointer: cs.pointerEvents,
          });
        }
      }

      // 2) 对关键控件做 elementFromPoint 命中测试
      const targets = [
        '.nav-item[data-route="home"]',
        '.nav-item[data-route="study"]',
        '.nav-item[data-route="settings"]',
        '#btn-theme',
        '#btn-sound',
        '#btn-settings',
      ];
      const unreachable = [];
      for (const sel of targets) {
        const el = document.querySelector(sel);
        if (!el) { unreachable.push({ sel, why: '元素不存在' }); continue; }
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) { unreachable.push({ sel, why: '尺寸为 0' }); continue; }
        const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (!top) { unreachable.push({ sel, why: '该坐标没有任何元素' }); continue; }
        if (top !== el && !el.contains(top) && !top.contains(el)) {
          unreachable.push({
            sel,
            why: '被挡住',
            blocker: top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') +
                     (typeof top.className === 'string' && top.className ? '.' + String(top.className).split(' ')[0] : ''),
          });
        }
      }
      return { blockers, unreachable };
    };
    true;
  `);

  /* -------- 检测器自检：故意注入全屏遮罩，确认它真的能发现问题 -------- */
  const canary = await js(`
    (() => {
      const d = document.createElement('div');
      d.id = 'canary-overlay';
      d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.2)';
      document.body.appendChild(d);
      const report = window.__hitAudit();
      d.remove();
      return { detected: report.blockers.some(b => b.id === 'canary-overlay') };
    })()
  `);
  console.log('hit-test 检测器自检: ' + (canary && canary.detected ? '有效 ✓' : '失效 ✗'));
  if (!canary || !canary.detected) {
    problems.push('[fatal] 命中测试检测器本身失效，本次可交互性审计结果不可信');
  }

  /** 跑一次真实的可交互性审计 */
  async function auditHits(label) {
    const report = await js('window.__hitAudit()');
    if (!report) {
      problems.push(`[hit:${label}] 审计执行失败`);
      return;
    }
    for (const b of report.blockers) {
      problems.push(`[hit:${label}] 全屏浮层可能吞掉点击: <${b.tag}${b.id ? '#' + b.id : ''} class="${b.cls}"> z=${b.z} bg=${b.bg} pointer-events=${b.pointer}`);
    }
    for (const u of report.unreachable) {
      problems.push(`[hit:${label}] 控件点不到: ${u.sel} —— ${u.why}${u.blocker ? ' by ' + u.blocker : ''}`);
    }
    console.log(`hit audit (${label}): 全屏浮层 ${report.blockers.length} 个, 点不到的控件 ${report.unreachable.length} 个`);
  }

  await guard('setup', `window.WM.views.applySettings({ autoNext: false }); true`);
  await sleep(300);
  await auditHits('home');

  /* -------------------- 1. 首页（深色） -------------------- */
  await shot('home-dark');
  await shotRegion('hero', '.hero');
  await shotRegion('home-levels', '.grid.side');

  /* ------------- 2. 真实鼠标点击导航，验证界面可交互 ------------- */
  await realClick('.nav-item[data-route="settings"]', '侧栏 → 设置');
  await sleep(600);
  const onSettings = await js(`document.querySelector('.level-grid') !== null`);
  if (!onSettings) problems.push('[interactive] 真实点击侧栏「设置」没有切换页面 —— 界面可能点不动');
  await shot('settings-dark');
  await shotRegion('level-grid', '.level-grid');

  /* ------------- 3. 真实鼠标点击等级卡片 ------------- */
  await realClick('.level-card:nth-child(3)', '词库卡片 · 高中');
  await sleep(700);
  const levelsAfter = await js(`JSON.stringify(window.WM.store.get().settings.levels)`);
  console.log('  点击后词库范围: ' + levelsAfter);
  if (!String(levelsAfter).includes('senior')) {
    problems.push('[interactive] 真实点击词库卡片没有生效');
  }
  await shot('settings-levels-dark', 700);

  /* -------------------- 4. 开始学习 -------------------- */
  await guard('study', `window.WM.app.startStudy('mixed'); true`);
  await sleep(700);
  await auditHits('study');
  await shot('study-question-dark', 300);
  await shotRegion('question-card', '.qcard');

  /* ------------- 5. 真实鼠标点击正确选项 ------------- */
  const correctSelector = await js(`
    (() => {
      const s = window.WM.study.session;
      if (!s || !s.current) return null;
      return '.opt[data-index="' + s.current.answerIndex + '"]';
    })()
  `);
  if (!correctSelector) {
    problems.push('[interactive] 拿不到当前题目的正确选项');
  } else {
    await realClick(correctSelector, '选择正确答案');
    await sleep(400);
    const answered = await js(`!!document.querySelector('.feedback')`);
    if (!answered) problems.push('[interactive] 真实点击选项后没有出现答题反馈 —— 界面可能点不动');
    else console.log('  答题反馈已出现 ✓');
  }
  await shot('study-correct-dark');
  await shotRegion('feedback-correct', '.qcard');

  /* -------------------- 6. 连续答题推进进度 -------------------- */
  for (let i = 0; i < 6; i++) {
    await guard('next', `
      (() => {
        const s = window.WM.study.session;
        if (!s) return true;
        if (s.answered) { const c = document.querySelector('.feedback .btn'); if (c) c.click(); }
        return true;
      })()
    `);
    await sleep(240);
    await guard('answer-seq', `
      (() => {
        const s = window.WM.study.session;
        if (!s || !s.current || s.answered) return true;
        const idx = ${i} % 2 === 0 ? s.current.answerIndex : (s.current.answerIndex + 1) % 4;
        document.querySelectorAll('.opt')[idx].click();
        return true;
      })()
    `);
    await sleep(240);
  }
  await shot('study-midway-dark', 900);

  /* -------------------- 7. 答错反馈 -------------------- */
  await guard('advance', `
    (() => {
      const s = window.WM.study.session;
      if (s && s.answered) { const c = document.querySelector('.feedback .btn'); if (c) c.click(); }
      return true;
    })()
  `);
  await sleep(320);
  const wrongSelector = await js(`
    (() => {
      const s = window.WM.study.session;
      if (!s || !s.current || s.answered) return null;
      return '.opt[data-index="' + ((s.current.answerIndex + 1) % 4) + '"]';
    })()
  `);
  if (wrongSelector) await realClick(wrongSelector, '选择错误答案');
  await shot('study-wrong-dark');
  await shotRegion('feedback-wrong', '.qcard');

  /* -------------------- 8. 中译英题目 -------------------- */
  await guard('exit-study', `window.WM.study.destroy(); window.WM.app.go('settings'); true`);
  await sleep(300);
  await guard('dir-zh2en', `
    (() => {
      const btns = Array.from(document.querySelectorAll('.theme-card .tc-name'));
      const target = btns.find(b => b.textContent.includes('中译英'));
      if (target) target.closest('button').click();
      return !!target;
    })()
  `);
  await sleep(400);
  await guard('home-again', `window.WM.app.go('home'); true`);
  await sleep(400);
  await guard('study2', `window.WM.app.startStudy('new'); true`);
  await shot('study-zh2en-dark', 900);

  /* -------------------- 9. 生词本 / 统计 -------------------- */
  await guard('to-wordbook', `window.WM.study.destroy(); window.WM.app.go('wordbook'); true`);
  await shot('wordbook-dark', 800);
  await shotRegion('wordbook-table', '.table');

  await guard('to-stats', `window.WM.app.go('stats'); true`);
  await shot('stats-dark', 800);

  /* ------------- 10. 真实鼠标点击标题栏主题按钮 ------------- */
  await realClick('#btn-theme', '标题栏 → 切换主题');
  await sleep(700);
  const themeNow = await js(`document.documentElement.dataset.theme`);
  console.log('  切换后主题: ' + themeNow);
  if (themeNow !== 'light') problems.push('[interactive] 真实点击主题按钮没有切换到浅色主题');
  await shot('stats-light', 800);

  await guard('home-light', `window.WM.app.go('home'); true`);
  await shot('home-light', 800);

  await guard('study-light', `window.WM.app.startStudy('mixed'); true`);
  await shot('study-light', 900);

  await guard('answer-light', `
    (() => {
      const s = window.WM.study.session;
      if (!s || !s.current) return false;
      document.querySelectorAll('.opt')[s.current.answerIndex].click();
      return true;
    })()
  `);
  await shot('study-correct-light');

  await guard('wordbook-light', `window.WM.study.destroy(); window.WM.app.go('wordbook'); true`);
  await shot('wordbook-light', 800);

  await guard('settings-light', `window.WM.app.go('settings'); true`);
  await shot('settings-light', 800);
  await auditHits('settings');

  /* -------------------- 11. 结构快照 -------------------- */
  const audit = await guard('audit', `
    (() => {
      const state = window.WM.store.get();
      const plan = window.WM.bank.ensurePlan(state);
      const overlay = document.getElementById('modal-host');
      return JSON.stringify({
        words: Object.keys(state.words).length,
        planNew: plan.newIds.length,
        planReview: plan.reviewIds.length,
        historyDays: Object.keys(state.history).length,
        direction: state.settings.direction,
        levels: state.settings.levels,
        theme: document.documentElement.dataset.theme,
        navItems: document.querySelectorAll('.nav-item').length,
        wordBanks: window.WM.bank.levels().map(l => l.id + ':' + l.total).join(','),
        modalHostHidden: overlay ? overlay.hasAttribute('hidden') : null,
        modalHostDisplay: overlay ? getComputedStyle(overlay).display : null,
      }, null, 2);
    })()
  `);

  // Windows 上 Electron 是 GUI 子系统，stdout 常被丢弃，因此同时写一份报告文件
  const lines = [];
  lines.push('=== runtime audit ===');
  lines.push(audit || '(audit step failed)');
  lines.push('');
  lines.push('=== problems ===');
  if (problems.length) for (const p of problems) lines.push('  ✗ ' + p);
  else lines.push('  (none)');
  lines.push('');
  lines.push('=== shots ===');
  for (const f of fs.readdirSync(OUT_DIR).sort()) lines.push('  ' + f);
  const report = lines.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'report.txt'), report, 'utf8');
  console.log(report);

  win.destroy();
  app.quit();
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error('capture failed:', err);
    app.exit(1);
  }),
);

app.on('window-all-closed', () => app.quit());
