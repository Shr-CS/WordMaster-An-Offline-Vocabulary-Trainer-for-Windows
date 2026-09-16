'use strict';

/**
 * test-scheduling.js — 复习算法无头测试
 *
 * 在 Node 里用 vm 加载真实的 util.js / store.js / bank.js（不改一行源码），
 * 通过接管 util.dayStr 来操控「今天」，从而验证核心需求：
 *   「今天背的单词，第二天一定会进入复习」
 * 以及间隔推进 1→2→4→7→15→30 天、答错回退、上限生效、打卡连续天数等行为。
 *
 * 用法：node tools/test-scheduling.js
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* --------------------------- 搭建最小浏览器环境 --------------------------- */

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
  };
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  localStorage: makeStorage(),
  requestAnimationFrame: (fn) => { fn(0); return 0; },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, classList: { add() {}, toggle() {} }, addEventListener() {} }),
    createElementNS: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
    addEventListener() {},
    documentElement: { dataset: {} },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

function run(relPath) {
  const code = fs.readFileSync(path.join(SRC, relPath), 'utf8');
  vm.runInContext(code, sandbox, { filename: relPath });
}

run('data/words.js');
run('js/util.js');
run('js/store.js');
run('js/bank.js');

const WM = sandbox.WM;
const util = WM.util;
const bank = WM.bank;

/* ------------------------------- 测试脚手架 ------------------------------- */

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    failures.push(label + (detail ? '  -> ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''));
  }
}

/** 可控时钟：把 util.dayStr 换掉，就能让「今天」在测试里前进 */
const clock = { now: '2025-03-01' };
util.dayStr = () => clock.now;
const setDay = (d) => { clock.now = d; };
const plus = (d, n) => util.addDays(d, n);

function freshState(overrides = {}) {
  const state = WM.store.defaultState();
  state.settings.levels = ['junior'];
  state.settings.dailyCount = 20;
  state.settings.reviewLimit = 60;
  Object.assign(state.settings, overrides);
  return state;
}

/* ============================ 场景 1：次日复习 ============================ */

console.log('\n[场景 1] 第一天学的新词，第二天必须进入复习队列');
setDay('2025-03-01');
let state = freshState();

let plan = bank.ensurePlan(state, { rebuild: true });
check('第一天生成 20 个新词', plan.newIds.length === 20, `实际 ${plan.newIds.length}`);
check('第一天没有复习任务', plan.reviewIds.length === 0, `实际 ${plan.reviewIds.length}`);

const day1Ids = plan.newIds.slice();
for (const id of day1Ids) bank.recordAnswer(state, id, true, 'new', true);

check('20 个单词写入档案', Object.keys(state.words).length === 20, `实际 ${Object.keys(state.words).length}`);
check('全部计划次日复习', day1Ids.every((id) => state.words[id].nextReview === '2025-03-02'),
  JSON.stringify(day1Ids.map((id) => state.words[id].nextReview).slice(0, 3)));
check('初始掌握等级为 0', day1Ids.every((id) => state.words[id].box === 0));
check('当日流水记录 20 个新词', state.history['2025-03-01'].newCount === 20, JSON.stringify(state.history['2025-03-01']));
check('打卡天数 = 1', state.streak.current === 1, String(state.streak.current));

/* ============================ 场景 2：第二天复习 ============================ */

console.log('\n[场景 2] 第二天打开应用，昨天那 20 个词出现在复习队列');
setDay('2025-03-02');
plan = bank.ensurePlan(state, { rebuild: true });

check('复习队列正好是昨天那 20 个', plan.reviewIds.length === 20 && day1Ids.every((id) => plan.reviewIds.includes(id)),
  `复习 ${plan.reviewIds.length}，交集 ${plan.reviewIds.filter((id) => day1Ids.includes(id)).length}`);
check('复习队列不含新词', plan.reviewIds.every((id) => !plan.newIds.includes(id)));
check('当天另有 20 个新词', plan.newIds.length === 20, `实际 ${plan.newIds.length}`);
check('新词与已学单词不重复', plan.newIds.every((id) => !state.words[id]));

// 15 个答对、5 个答错
const okIds = plan.reviewIds.slice(0, 15);
const badIds = plan.reviewIds.slice(15);
okIds.forEach((id) => bank.recordAnswer(state, id, true, 'review', true));
badIds.forEach((id) => bank.recordAnswer(state, id, false, 'review', true));

check('答对的 15 个推进到等级 1', okIds.every((id) => state.words[id].box === 1));
check('答对的间隔变为 2 天后', okIds.every((id) => state.words[id].nextReview === plus('2025-03-02', 2)),
  okIds.map((id) => state.words[id].nextReview)[0]);
check('答错的 5 个退回等级 0', badIds.every((id) => state.words[id].box === 0));
check('答错的次日重来', badIds.every((id) => state.words[id].nextReview === '2025-03-03'));
check('当日复习流水 = 20', state.history['2025-03-02'].reviewCount === 20, JSON.stringify(state.history['2025-03-02']));
check('打卡天数 = 2', state.streak.current === 2, String(state.streak.current));

/* ============================ 场景 3：错词重练不重复计数 ============================ */

console.log('\n[场景 3] 同一词当天第二次作答（错题重练）不改动复习计划');
const probe = badIds[0];
const beforeBox = state.words[probe].box;
const beforeNext = state.words[probe].nextReview;
const beforeReviewCount = state.history['2025-03-03'] ? 0 : (state.history['2025-03-02'].reviewCount);
bank.recordAnswer(state, probe, true, 'review', false);
check('重练不改变复习日期', state.words[probe].nextReview === beforeNext, `${beforeNext} -> ${state.words[probe].nextReview}`);
check('重练不改变掌握等级', state.words[probe].box === beforeBox);
check('重练不重复计入当日复习数', state.history['2025-03-02'].reviewCount === beforeReviewCount,
  `期望 ${beforeReviewCount}，实际 ${state.history['2025-03-02'].reviewCount}`);

/* ============================ 场景 4：第三天 ============================ */

console.log('\n[场景 4] 第三天只有答错的 5 个需要复习（答对的 15 个已推到 3-04）');
setDay('2025-03-03');
plan = bank.ensurePlan(state, { rebuild: true });
check('复习队列恰为那 5 个错词', plan.reviewIds.length === 5 && badIds.every((id) => plan.reviewIds.includes(id)),
  `实际 ${plan.reviewIds.length}`);
check('3-04 到期的词不在今天的队列里', plan.reviewIds.every((id) => state.words[id].nextReview === '2025-03-03'));

badIds.forEach((id) => bank.recordAnswer(state, id, true, 'review', true));
check('改对后推进到等级 1', badIds.every((id) => state.words[id].box === 1));
check('改对后间隔 2 天', badIds.every((id) => state.words[id].nextReview === plus('2025-03-03', 2)));

/* ============================ 场景 5：间隔阶梯 ============================ */

console.log('\n[场景 5] 连续答对时复习间隔按 1/2/4/7/15/30 天递增，最后标记为已掌握');
setDay('2025-04-01');
const ladder = freshState({ dailyCount: 5 });
let lp = bank.ensurePlan(ladder, { rebuild: true });
const trackId = lp.newIds[0];
bank.recordAnswer(ladder, trackId, true, 'new', true);

const EXPECTED = [1, 2, 4, 7, 15, 30];
const observed = [];
for (let step = 0; step < EXPECTED.length; step++) {
  const due = ladder.words[trackId].nextReview;
  const gap = util.diffDays(bank.today(), due);
  observed.push(gap);
  setDay(due);
  bank.recordAnswer(ladder, trackId, true, 'review', true);
}
check('间隔序列为 1,2,4,7,15,30', observed.join(',') === EXPECTED.join(','), observed.join(','));
check('跑满阶梯后标记为已掌握', ladder.words[trackId].mastered === true,
  `box=${ladder.words[trackId].box}, mastered=${ladder.words[trackId].mastered}`);
check('已掌握的单词不再进入复习队列', bank.dueRecords(ladder).every((w) => w.id !== trackId));

/* ============================ 场景 6：上限与稳定性 ============================ */

console.log('\n[场景 6] 复习上限、计划稳定性、连续打卡中断');
setDay('2025-05-01');
const capped = freshState({ dailyCount: 30, reviewLimit: 10 });
let cp = bank.ensurePlan(capped, { rebuild: true });
for (const id of cp.newIds) bank.recordAnswer(capped, id, true, 'new', true);
setDay('2025-05-02');
cp = bank.ensurePlan(capped, { rebuild: true });
check('复习上限生效（30 个到期只排 10 个）', cp.reviewIds.length === 10, `实际 ${cp.reviewIds.length}`);

const orderA = bank.ensurePlan(capped).reviewIds.join(',');
const orderB = bank.ensurePlan(capped).reviewIds.join(',');
check('重复调用不改变队列顺序', orderA === orderB);

// 5-02 也学习一次，使连续打卡累加到 2
bank.recordAnswer(capped, cp.reviewIds[0], true, 'review', true);
check('连续第二天打卡累加到 2', capped.streak.current === 2, String(capped.streak.current));

// 连续打卡：跳到 5-05 再学（中间空了两天），连续天数应重新从 1 开始，但历史最佳要保留
setDay('2025-05-05');
const p5 = bank.ensurePlan(capped, { rebuild: true });
bank.recordAnswer(capped, p5.reviewIds[0] || p5.newIds[0], true, p5.reviewIds.length ? 'review' : 'new', true);
check('中断后续打卡重置为 1', capped.streak.current === 1, String(capped.streak.current));
check('历史最佳仍保留为 2', capped.streak.best === 2, String(capped.streak.best));

/* ============================ 场景 7：多词库范围 ============================ */

console.log('\n[场景 7] 多词库范围下新词在各级之间均匀分布');
setDay('2025-06-01');
const multi = freshState({ levels: ['primary', 'junior', 'senior', 'cet4'], dailyCount: 40 });
const mp = bank.ensurePlan(multi, { rebuild: true });
const counts = {};
for (const id of mp.newIds) {
  const lv = id.split(':')[0];
  counts[lv] = (counts[lv] || 0) + 1;
}
const spread = Object.values(counts);
check('40 个新词覆盖全部 4 个等级', Object.keys(counts).length === 4, JSON.stringify(counts));
check('各等级数量均衡（最大最小差 ≤ 2）', spread.length === 4 && Math.max(...spread) - Math.min(...spread) <= 2,
  JSON.stringify(counts));

/* ============================ 场景 8：词库完整性 ============================ */

console.log('\n[场景 8] 每个等级的单词都能生成 4 个不重复选项');
run('js/quiz.js');
const quiz = WM.quiz;
let worst = 99;
let broken = 0;
for (const lv of bank.levels()) {
  const pool = quiz.poolForSession({ settings: { levels: [lv.id] }, words: {} });
  for (const dir of ['en2zh', 'zh2en']) {
    for (const entry of bank.list(lv.id)) {
      const q = quiz.makeQuestion(entry, { direction: dir, pool, random: Math.random });
      const texts = new Set(q.options.map((o) => util.norm(o.text)));
      if (q.options.length !== 4) broken += 1;
      if (texts.size !== 4) broken += 1;
      if (!q.options[q.answerIndex].ok) broken += 1;
      worst = Math.min(worst, texts.size);
    }
  }
}
check(`全部 ${bank.totalWords()} 词 × 2 方向都能出 4 个互不相同的选项`, broken === 0, `异常 ${broken} 处`);
check('选项去重后最小值 = 4', worst === 4, String(worst));

/* ------------------------------- 汇总 ------------------------------- */

console.log('\n' + '='.repeat(58));
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log('  · ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 —— 复习调度符合预期');
}
