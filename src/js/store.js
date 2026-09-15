/* ============================================================================
   store.js — 状态持久化
   state 结构：
   {
     version, settings, words{}, history{}, plan, streak{}, createdAt
   }
   - words：已学单词档案（含复习计划），key = "等级:单词"
   - history：按天的学习流水
   - plan：当天的学习计划（新词队列 + 复习队列 + 完成情况）
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const STORAGE_KEY = 'wordmaster.state.v1';
  const CURRENT_VERSION = 1;

  const DEFAULT_SETTINGS = {
    levels: ['junior'],        // 词库范围（可多选）
    dailyCount: 20,            // 每天新词数量
    direction: 'mixed',        // en2zh | zh2en | mixed
    theme: 'dark',             // dark | light
    sound: true,               // 音效开关
    volume: 0.7,               // 音量 0~1
    autoPronounce: true,       // 出现英文题面时自动朗读
    autoNext: true,            // 答对后自动进入下一题
    autoNextDelay: 1100,       // 自动下一题延迟(ms)，留足看清释义的时间
    reviewLimit: 60,           // 每天复习上限
  };

  function defaultState() {
    return {
      version: CURRENT_VERSION,
      createdAt: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, levels: [...DEFAULT_SETTINGS.levels] },
      words: {},
      history: {},
      plan: null,
      streak: { current: 0, best: 0, lastDay: null },
    };
  }

  const DIRECTIONS = ['en2zh', 'zh2en', 'mixed'];

  /** 把任意来源的数据规整成合法 state，坏字段一律回落到默认值 */
  function sanitize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const src = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const s = base.settings;
    if (Array.isArray(src.levels)) {
      const valid = src.levels.filter((id) => typeof id === 'string');
      s.levels = valid.length ? valid : [...DEFAULT_SETTINGS.levels];
    }
    s.dailyCount = WM.util.clamp(Math.round(Number(src.dailyCount)) || DEFAULT_SETTINGS.dailyCount, 5, 200);
    s.direction = DIRECTIONS.includes(src.direction) ? src.direction : DEFAULT_SETTINGS.direction;
    s.theme = src.theme === 'light' ? 'light' : 'dark';
    s.sound = src.sound !== false;
    s.volume = WM.util.clamp(Number(src.volume) >= 0 ? Number(src.volume) : DEFAULT_SETTINGS.volume, 0, 1);
    s.autoPronounce = src.autoPronounce !== false;
    s.autoNext = src.autoNext !== false;
    s.autoNextDelay = WM.util.clamp(Math.round(Number(src.autoNextDelay)) || DEFAULT_SETTINGS.autoNextDelay, 300, 3000);
    s.reviewLimit = WM.util.clamp(Math.round(Number(src.reviewLimit)) || DEFAULT_SETTINGS.reviewLimit, 10, 300);

    // 单词档案
    if (raw.words && typeof raw.words === 'object') {
      for (const [key, rec] of Object.entries(raw.words)) {
        if (!rec || typeof rec !== 'object' || !rec.en) continue;
        base.words[key] = {
          id: key,
          level: String(rec.level || key.split(':')[0] || ''),
          en: String(rec.en),
          zh: String(rec.zh || ''),
          pos: String(rec.pos || ''),
          ipa: String(rec.ipa || ''),
          box: WM.util.clamp(Math.round(Number(rec.box)) || 0, 0, 5),
          learnedAt: String(rec.learnedAt || WM.util.dayStr()),
          lastSeen: String(rec.lastSeen || rec.learnedAt || WM.util.dayStr()),
          nextReview: String(rec.nextReview || WM.util.addDays(WM.util.dayStr(), 1)),
          correct: Math.max(0, Math.round(Number(rec.correct)) || 0),
          wrong: Math.max(0, Math.round(Number(rec.wrong)) || 0),
          streak: Math.max(0, Math.round(Number(rec.streak)) || 0),
          starred: !!rec.starred,
          mastered: !!rec.mastered,
        };
      }
    }

    // 每日流水
    if (raw.history && typeof raw.history === 'object') {
      for (const [day, rec] of Object.entries(raw.history)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !rec || typeof rec !== 'object') continue;
        base.history[day] = {
          newCount: Math.max(0, Math.round(Number(rec.newCount)) || 0),
          reviewCount: Math.max(0, Math.round(Number(rec.reviewCount)) || 0),
          correct: Math.max(0, Math.round(Number(rec.correct)) || 0),
          wrong: Math.max(0, Math.round(Number(rec.wrong)) || 0),
          seconds: Math.max(0, Math.round(Number(rec.seconds)) || 0),
        };
      }
    }

    // 打卡
    if (raw.streak && typeof raw.streak === 'object') {
      base.streak = {
        current: Math.max(0, Math.round(Number(raw.streak.current)) || 0),
        best: Math.max(0, Math.round(Number(raw.streak.best)) || 0),
        lastDay: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.streak.lastDay)) ? String(raw.streak.lastDay) : null,
      };
    }

    // 计划（结构简单，按需重建）
    if (raw.plan && typeof raw.plan === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.plan.date))) {
      base.plan = {
        date: String(raw.plan.date),
        sig: String(raw.plan.sig || ''),
        newIds: Array.isArray(raw.plan.newIds) ? raw.plan.newIds.filter((x) => typeof x === 'string') : [],
        reviewIds: Array.isArray(raw.plan.reviewIds) ? raw.plan.reviewIds.filter((x) => typeof x === 'string') : [],
        doneNew: raw.plan.doneNew && typeof raw.plan.doneNew === 'object' ? { ...raw.plan.doneNew } : {},
        doneReview: raw.plan.doneReview && typeof raw.plan.doneReview === 'object' ? { ...raw.plan.doneReview } : {},
      };
    }

    if (typeof raw.createdAt === 'string') base.createdAt = raw.createdAt;
    return base;
  }

  /* ------------------------------- 读写 ------------------------------- */

  let state = null;
  let saveTimer = null;
  const listeners = new Set();

  function load() {
    let raw = null;
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (text) raw = JSON.parse(text);
    } catch (err) {
      console.warn('[store] 读取本地数据失败，将重新开始：', err);
    }
    state = sanitize(raw);
    return state;
  }

  function persistNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error('[store] 保存失败：', err);
      WM.util.toast('本地保存失败，请检查磁盘空间', 'err', 3600);
      return false;
    }
  }

  /** 变更后调用：合并写入 + 通知订阅者 */
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow();
    }, 220);
    emit();
  }

  /** 立即落盘（退出前、导入后等场景） */
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return persistNow();
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (err) {
        console.error('[store] 订阅回调异常：', err);
      }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function get() {
    if (!state) load();
    return state;
  }

  function setSettings(patch) {
    const s = get().settings;
    Object.assign(s, patch);
    const clean = sanitize({ settings: s, words: {}, history: {}, streak: {} }).settings;
    get().settings = clean;
    save();
    return clean;
  }

  function reset() {
    state = defaultState();
    persistNow();
    emit();
    return state;
  }

  function exportJSON() {
    return JSON.stringify(
      {
        app: 'WordMaster',
        exportedAt: new Date().toISOString(),
        data: get(),
      },
      null,
      2,
    );
  }

  /**
   * 导入备份。返回 { ok, message }
   */
  function importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: '文件不是合法的 JSON' };
    }
    const payload = parsed && parsed.data ? parsed.data : parsed;
    if (!payload || typeof payload !== 'object' || (!payload.words && !payload.settings)) {
      return { ok: false, message: '文件内容不像 WordMaster 的备份' };
    }
    state = sanitize(payload);
    persistNow();
    emit();
    return { ok: true, message: `已恢复 ${Object.keys(state.words).length} 个单词的学习记录` };
  }

  WM.store = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    defaultState,
    sanitize,
    load, save, flush, get, subscribe, setSettings, reset,
    exportJSON, importJSON,
  };
})(window.WM);
