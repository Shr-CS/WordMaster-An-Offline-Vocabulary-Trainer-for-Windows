/* ============================================================================
   bank.js — 词库注册、范围筛选、学习计划与复习调度
   复习算法（简化版 Leitner / 艾宾浩斯）：
     box 0 → 次日复习      刚学完的词，第二天必须复习
     box 1 → 2 天后       复习答对，间隔拉长
     box 2 → 4 天后
     box 3 → 7 天后
     box 4 → 15 天后
     box 5 → 30 天后（视为已掌握）
   任意一次答错 → 直接退回 box 0，第二天再来。
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const util = WM.util;

  /** 词库等级注册表 */
  const LEVELS = [
    { id: 'primary', name: '小学', desc: '小学英语核心词', color: '#f59e0b' },
    { id: 'junior', name: '初中', desc: '中考大纲高频词', color: '#10b981' },
    { id: 'senior', name: '高中', desc: '高考高频词', color: '#3b82f6' },
    { id: 'cet4', name: '四级', desc: 'CET-4 核心词', color: '#8b5cf6' },
    { id: 'cet6', name: '六级', desc: 'CET-6 核心词', color: '#ec4899' },
    { id: 'ielts', name: '雅思', desc: 'IELTS 话题词', color: '#06b6d4' },
    { id: 'toefl', name: '托福', desc: 'TOEFL 学术词', color: '#ef4444' },
  ];

  const INTERVALS = [1, 2, 4, 7, 15, 30];
  const MASTER_BOX = INTERVALS.length - 1;

  const RAW = window.WM_DATA || {};

  /** levelId -> [ {id, level, en, zh, pos, ipa} ] */
  const byLevel = new Map();
  /** id -> entry */
  const byId = new Map();

  function buildIndex() {
    byLevel.clear();
    byId.clear();
    for (const level of LEVELS) {
      const rows = Array.isArray(RAW[level.id]) ? RAW[level.id] : [];
      const list = [];
      for (const row of rows) {
        if (!row || !row.en || !row.zh) continue;
        const entry = {
          id: `${level.id}:${row.en}`,
          level: level.id,
          en: String(row.en),
          zh: String(row.zh),
          pos: String(row.pos || ''),
          ipa: String(row.ipa || ''),
          // 例句用于答对后的详细词条卡；老词库没有这两个字段时留空
          ex: String(row.ex || ''),
          exZh: String(row.exZh || ''),
        };
        if (byId.has(entry.id)) continue;
        byId.set(entry.id, entry);
        list.push(entry);
      }
      byLevel.set(level.id, list);
    }
  }

  buildIndex();

  /** 带词条数量的等级列表 */
  function levels() {
    return LEVELS.map((lv) => ({ ...lv, total: (byLevel.get(lv.id) || []).length }));
  }

  function levelMeta(id) {
    return LEVELS.find((lv) => lv.id === id) || { id, name: id, desc: '', color: '#888' };
  }

  function list(levelId) {
    return byLevel.get(levelId) || [];
  }

  function get(id) {
    return byId.get(id) || null;
  }

  function all() {
    return Array.from(byId.values());
  }

  /** 依据所选等级取候选词池；若为空则回落到全部词库 */
  function poolFor(levelIds) {
    const ids = Array.isArray(levelIds) && levelIds.length ? levelIds : LEVELS.map((l) => l.id);
    const out = [];
    for (const id of ids) out.push(...list(id));
    return out.length ? out : all();
  }

  function totalWords() {
    return byId.size;
  }

  function dataReady() {
    return byId.size > 0;
  }

  /* ------------------------------ 时间与统计 ------------------------------ */

  function today() {
    return util.dayStr();
  }

  /** 已学单词档案是否今天到期 */
  function isDue(record, day = today()) {
    return !!record && !record.mastered && !!record.nextReview && record.nextReview <= day;
  }

  function dueRecords(state, day = today()) {
    return Object.values(state.words).filter((rec) => isDue(rec, day));
  }

  function historyOf(state, day = today()) {
    const rec = state.history[day];
    return rec || { newCount: 0, reviewCount: 0, correct: 0, wrong: 0, seconds: 0 };
  }

  /** 确保当天的学习计划存在；设置变化或跨天时重建 */
  function ensurePlan(state, { rebuild = false } = {}) {
    const day = today();
    const s = state.settings;
    const sig = [s.levels.slice().sort().join(','), s.dailyCount, s.reviewLimit].join('|');
    const plan = state.plan;
    if (!rebuild && plan && plan.date === day && plan.sig === sig) return plan;
    state.plan = buildPlan(state, day, sig, plan);
    return state.plan;
  }

  function buildPlan(state, day, sig, previous) {
    const keep = previous && previous.date === day ? previous : null;
    const settings = state.settings;
    const seed = util.seedFrom(`${day}|${sig}`);
    const random = util.rng(seed);

    /* ---------- 复习队列：所有到期且未掌握的单词，最该复习的排最前 ---------- */
    const due = dueRecords(state, day).sort((a, b) => {
      if (a.nextReview !== b.nextReview) return a.nextReview < b.nextReview ? -1 : 1;
      if (a.wrong !== b.wrong) return b.wrong - a.wrong;
      return (a.lastSeen || '') < (b.lastSeen || '') ? -1 : 1;
    });

    const reviewIds = [];
    const seenReview = new Set();
    // 保留昨天计划里已经排好、且今天依然到期的顺序，避免刷新后顺序乱跳
    for (const id of keep ? keep.reviewIds : []) {
      const rec = state.words[id];
      if (rec && isDue(rec, day) && !seenReview.has(id)) {
        reviewIds.push(id);
        seenReview.add(id);
      }
    }
    for (const rec of due) {
      if (!seenReview.has(rec.id)) {
        reviewIds.push(rec.id);
        seenReview.add(rec.id);
      }
    }
    const limitedReview = reviewIds.slice(0, settings.reviewLimit);

    /* ------------------ 新词队列：未学过的词，各等级均匀轮取 ------------------ */
    const pool = poolFor(settings.levels).filter((entry) => !state.words[entry.id]);
    const poolIds = new Set(pool.map((entry) => entry.id));

    const newIds = [];
    const seenNew = new Set();
    for (const id of keep ? keep.newIds : []) {
      if (poolIds.has(id) && !seenNew.has(id)) {
        newIds.push(id);
        seenNew.add(id);
      }
    }

    if (newIds.length < settings.dailyCount) {
      // 每个等级内部先打乱，再按等级轮流取词，保证多等级混合时分布均匀
      const buckets = settings.levels
        .map((levelId) => util.shuffle(
          list(levelId).filter((entry) => !state.words[entry.id] && !seenNew.has(entry.id)).map((e) => e.id),
          random,
        ))
        .filter((bucket) => bucket.length);
      let cursor = 0;
      while (newIds.length < settings.dailyCount && buckets.some((b) => b.length)) {
        const bucket = buckets[cursor % buckets.length];
        cursor++;
        if (!bucket.length) continue;
        const id = bucket.shift();
        if (seenNew.has(id)) continue;
        newIds.push(id);
        seenNew.add(id);
      }
    }

    return {
      date: day,
      sig,
      newIds: newIds.slice(0, settings.dailyCount),
      reviewIds: limitedReview,
      doneNew: keep ? { ...keep.doneNew } : {},
      doneReview: keep ? { ...keep.doneReview } : {},
    };
  }

  /** 今日剩余任务量 */
  function planProgress(state) {
    const plan = ensurePlan(state);
    const newLeft = plan.newIds.filter((id) => !plan.doneNew[id]).length;
    const reviewLeft = plan.reviewIds.filter((id) => !plan.doneReview[id]).length;
    return {
      plan,
      newTotal: plan.newIds.length,
      reviewTotal: plan.reviewIds.length,
      newDone: plan.newIds.length - newLeft,
      reviewDone: plan.reviewIds.length - reviewLeft,
      newLeft,
      reviewLeft,
      totalLeft: newLeft + reviewLeft,
    };
  }

  /** 组装一次学习会话的题目队列 */
  function buildQueue(state, kind) {
    const plan = ensurePlan(state);
    const items = [];
    const push = (id, mode) => {
      if (!byId.has(id)) return;
      items.push({ id, mode });
    };

    if (kind === 'review' || kind === 'mixed') {
      for (const id of plan.reviewIds) if (!plan.doneReview[id]) push(id, 'review');
    }
    if (kind === 'new' || kind === 'mixed') {
      for (const id of plan.newIds) if (!plan.doneNew[id]) push(id, 'new');
    }
    // 混合模式下把复习和新词交错，避免「先做 60 道复习」的疲劳感
    if (kind === 'mixed' && items.length > 6) {
      const reviews = items.filter((it) => it.mode === 'review');
      const news = items.filter((it) => it.mode === 'new');
      const merged = [];
      let ri = 0;
      let ni = 0;
      while (ri < reviews.length || ni < news.length) {
        if (ni < news.length) merged.push(news[ni++]);
        if (ri < reviews.length) merged.push(reviews[ri++]);
      }
      return merged;
    }
    return items;
  }

  /* ------------------------------- 答题结算 ------------------------------- */

  /** 记录「首次见到该单词」——无论对错，明天都会进入复习 */
  function registerNewWord(state, entry, ok) {
    const day = today();
    const record = {
      id: entry.id,
      level: entry.level,
      en: entry.en,
      zh: entry.zh,
      pos: entry.pos,
      ipa: entry.ipa,
      ex: entry.ex || '',
      exZh: entry.exZh || '',
      box: 0,
      learnedAt: day,
      lastSeen: day,
      nextReview: util.addDays(day, INTERVALS[0]),
      correct: ok ? 1 : 0,
      wrong: ok ? 0 : 1,
      streak: ok ? 1 : 0,
      starred: false,
      mastered: false,
    };
    state.words[entry.id] = record;
    return record;
  }

  /** 复习一个已学单词并推进/回退复习间隔 */
  function gradeWord(state, id, ok) {
    const record = state.words[id];
    if (!record) return null;
    const day = today();
    if (ok) {
      record.correct += 1;
      record.streak = (record.streak || 0) + 1;
      record.box = Math.min((record.box || 0) + 1, MASTER_BOX);
    } else {
      record.wrong += 1;
      record.streak = 0;
      record.box = 0;
    }
    record.lastSeen = day;
    record.nextReview = util.addDays(day, INTERVALS[record.box]);
    record.mastered = record.box >= MASTER_BOX;
    return record;
  }

  /** 打卡：第一次学习当天记为连续的一天 */
  function touchStreak(state) {
    const day = today();
    const streak = state.streak;
    if (streak.lastDay === day) return;
    const yesterday = util.addDays(day, -1);
    streak.current = streak.lastDay === yesterday ? (streak.current || 0) + 1 : 1;
    streak.lastDay = day;
    streak.best = Math.max(streak.best || 0, streak.current);
  }

  /**
   * 统一入口：结算一次答题。
   * @param {object} state
   * @param {string} id      单词 id
   * @param {boolean} ok     是否答对
   * @param {'new'|'review'} mode 该题属于新词还是复习
   * @param {boolean} first  是否是该词今天第一次作答（重练不计入计划与调度）
   */
  function recordAnswer(state, id, ok, mode, first) {
    const entry = byId.get(id);
    if (!entry) return;

    const day = today();
    const hist = state.history[day] || (state.history[day] = { newCount: 0, reviewCount: 0, correct: 0, wrong: 0, seconds: 0 });

    if (!first) {
      // 错题重练：只累计对错，不改动复习计划
      if (ok) hist.correct += 1;
      else hist.wrong += 1;
      return;
    }

    hist.correct += ok ? 1 : 0;
    hist.wrong += ok ? 0 : 1;

    const plan = ensurePlan(state);
    if (mode === 'new') {
      if (!plan.doneNew[id]) {
        plan.doneNew[id] = { ok, at: Date.now() };
        hist.newCount += 1;
      }
      if (!state.words[id]) registerNewWord(state, entry, ok);
      else gradeWord(state, id, ok);
    } else {
      if (!plan.doneReview[id]) {
        plan.doneReview[id] = { ok, at: Date.now() };
        hist.reviewCount += 1;
      }
      gradeWord(state, id, ok);
    }
    touchStreak(state);
  }

  /** 累计本次会话时长 */
  function addStudySeconds(state, seconds) {
    const day = today();
    const hist = state.history[day] || (state.history[day] = { newCount: 0, reviewCount: 0, correct: 0, wrong: 0, seconds: 0 });
    hist.seconds += Math.max(0, Math.round(seconds));
  }

  /* ------------------------------- 进度统计 ------------------------------- */

  function learnedCount(state) {
    return Object.keys(state.words).length;
  }

  function masteredCount(state) {
    return Object.values(state.words).filter((w) => w.mastered).length;
  }

  /** 各等级进度：已学 / 总数 */
  function levelProgress(state) {
    return levels().map((lv) => {
      const total = lv.total;
      let learned = 0;
      for (const rec of Object.values(state.words)) if (rec.level === lv.id) learned += 1;
      return { ...lv, learned, percent: util.pct(learned, total) };
    });
  }

  /** 总体正确率 */
  function accuracy(state) {
    let correct = 0;
    let wrong = 0;
    for (const rec of Object.values(state.history)) {
      correct += rec.correct || 0;
      wrong += rec.wrong || 0;
    }
    const total = correct + wrong;
    return { correct, wrong, total, percent: util.pct(correct, total) };
  }

  /** 最近 n 天的学习曲线 */
  function recentDays(state, n = 7) {
    const out = [];
    const day = today();
    for (let i = n - 1; i >= 0; i--) {
      const d = util.addDays(day, -i);
      const rec = state.history[d] || { newCount: 0, reviewCount: 0, correct: 0, wrong: 0, seconds: 0 };
      out.push({ date: d, ...rec, isToday: d === day });
    }
    return out;
  }

  /** 未来 n 天的复习压力预览 */
  function upcoming(state, n = 7) {
    const out = [];
    const day = today();
    for (let i = 0; i < n; i++) {
      const d = util.addDays(day, i);
      const count = Object.values(state.words).filter((w) => !w.mastered && w.nextReview === d).length;
      out.push({ date: d, count });
    }
    return out;
  }

  WM.bank = {
    LEVELS, INTERVALS, MASTER_BOX,
    levels, levelMeta, list, get, all, poolFor, totalWords, dataReady,
    today, isDue, dueRecords, historyOf,
    ensurePlan, planProgress, buildQueue,
    registerNewWord, gradeWord, recordAnswer, addStudySeconds, touchStreak,
    learnedCount, masteredCount, levelProgress, accuracy, recentDays, upcoming,
  };
})(window.WM);
