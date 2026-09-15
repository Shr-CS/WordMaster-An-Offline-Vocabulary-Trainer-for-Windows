'use strict';

/**
 * selfcheck.js — 打包前的最终自检
 * 1) words.js 是否为合法 UTF-8、无 BOM、能被当作脚本执行
 * 2) 词条结构是否完整
 * 3) 模拟出题：为每个等级各抽 30 个词，检查都能凑出 4 个不重复选项
 *
 * 输出刻意使用 ASCII 转义，避免不同终端编码造成的误判。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'data', 'words.js');

const esc = (s) => String(s).split('').map((c) => (c.charCodeAt(0) < 128 ? c : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))).join('');

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exitCode = 1;
}

/* ---------------------------- 1. 加载并校验 ---------------------------- */
if (!fs.existsSync(FILE)) {
  fail('src/data/words.js not found - run: node tools/build-data.js');
  process.exit(1);
}

const src = fs.readFileSync(FILE, 'utf8');
console.log('file size        : ' + (Buffer.byteLength(src, 'utf8') / 1024).toFixed(1) + ' KB');
console.log('has BOM          : ' + (src.charCodeAt(0) === 0xfeff));
console.log('has U+FFFD       : ' + src.includes('\uFFFD'));

if (src.charCodeAt(0) === 0xfeff) fail('words.js has a BOM');
if (src.includes('\uFFFD')) fail('words.js contains replacement chars (encoding damaged)');

const sandbox = { window: {} };
try {
  vm.runInNewContext(src, sandbox, { filename: 'words.js' });
} catch (err) {
  fail('words.js threw while executing: ' + err.message);
  process.exit(1);
}

const DATA = sandbox.window.WM_DATA;
if (!DATA || typeof DATA !== 'object') {
  fail('window.WM_DATA was not defined');
  process.exit(1);
}

/* ---------------------------- 2. 结构完整性 ---------------------------- */
const LEVELS = ['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts', 'toefl'];
let total = 0;
let broken = 0;
for (const id of LEVELS) {
  const rows = DATA[id];
  if (!Array.isArray(rows)) {
    fail('missing level: ' + id);
    continue;
  }
  total += rows.length;
  for (const w of rows) {
    if (!w || !w.en || !w.zh || !w.pos || !w.ipa) broken += 1;
    if (typeof w.en !== 'string' || typeof w.zh !== 'string') broken += 1;
  }
  console.log('level ' + id.padEnd(8) + ': ' + String(rows.length).padStart(4) + ' words');
}
console.log('total words      : ' + total);
console.log('broken entries   : ' + broken);
if (broken) fail(broken + ' entries are missing fields');

/* ---------------------------- 3. 中文正确性抽查 ---------------------------- */
const sample = DATA.senior[0];
console.log('sample en        : ' + esc(sample.en));
console.log('sample zh        : ' + esc(sample.zh));
console.log('sample ipa       : ' + esc(sample.ipa));
if (!/[\u4e00-\u9fa5]/.test(sample.zh)) fail('Chinese gloss lost during build');

/* ---------------------------- 4. 模拟出题 ---------------------------- */
// 复刻 quiz.js 的取干扰项逻辑，确认任何词都能凑出 4 个互不相同的选项
const norm = (t) => String(t).toLowerCase().replace(/[\s\u3000·、，,。.；;（）()]/g, '');

function simulate(entries, direction) {
  const valueOf = (e) => (direction === 'en2zh' ? e.zh : e.en);
  let worstCaseOptions = 99;
  let problems = 0;

  for (const entry of entries) {
    const used = new Set([norm(valueOf(entry))]);
    const picked = [];
    // 优先同等级同词性，其次同等级，最后全库
    const tiers = [
      entries.filter((c) => c !== entry && c.pos && c.pos === entry.pos),
      entries.filter((c) => c !== entry),
    ];
    for (const tier of tiers) {
      for (const cand of tier) {
        if (picked.length >= 3) break;
        const key = norm(valueOf(cand));
        if (!key || used.has(key)) continue;
        used.add(key);
        picked.push(cand);
      }
    }
    const optionCount = 1 + picked.length;
    if (optionCount < worstCaseOptions) worstCaseOptions = optionCount;
    if (optionCount < 4) problems += 1;
  }
  return { worstCaseOptions, problems };
}

let allOk = true;
for (const id of LEVELS) {
  for (const dir of ['en2zh', 'zh2en']) {
    const res = simulate(DATA[id], dir);
    const ok = res.problems === 0 && res.worstCaseOptions === 4;
    if (!ok) allOk = false;
    console.log(
      'quiz ' + id.padEnd(8) + ' ' + dir.padEnd(6) +
      ': min options = ' + res.worstCaseOptions + ', insufficient = ' + res.problems + (ok ? '  OK' : '  << PROBLEM'),
    );
  }
}
if (!allOk) fail('some words cannot produce 4 distinct options');

if (!process.exitCode) console.log('\nSELF-CHECK PASSED');
