/**
 * list-dup-zh.js — 找出合并后各等级里「释义完全相同」的词条组。
 *
 * 为什么需要：选择题的干扰项来自同等级其他词条的释义，两条词释义一模一样时
 * 会出现两个正确选项；verify-words.js 的「唯一释义」检查也会失败。
 *
 *   node tools/list-dup-zh.js            输出报告，并写出 parts/_used/dupzh-<level>.json
 *   node tools/list-dup-zh.js --json     只输出 JSON
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'src', 'data');
const PARTS = path.join(DATA, 'parts');
const OUT = path.join(PARTS, '_used');
const LEVELS = ['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts', 'toefl'];
const JSON_ONLY = process.argv.includes('--json');

fs.mkdirSync(OUT, { recursive: true });

function loadLevel(lv) {
  const byEn = new Map();
  const add = (row) => {
    const k = String(row.en || '').trim().toLowerCase();
    if (!k || byEn.has(k)) return;
    byEn.set(k, { en: String(row.en).trim(), zh: String(row.zh || '').trim() });
  };
  const mainFile = path.join(DATA, lv + '.json');
  if (fs.existsSync(mainFile)) for (const r of JSON.parse(fs.readFileSync(mainFile, 'utf8'))) add(r);
  const listFiles = (kind) => (fs.existsSync(PARTS)
    ? fs.readdirSync(PARTS).filter((f) => f.startsWith(lv + '.' + kind) && f.endsWith('.json')).sort()
    : []);
  for (const f of listFiles('new')) {
    for (const r of JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8'))) add(r);
  }
  // 释义更正补丁要一并应用，否则会把已经修好的重复又报一遍
  for (const f of listFiles('zhfix')) {
    for (const r of JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8'))) {
      const k = String(r.en || '').trim().toLowerCase();
      const zh = String(r.zh || '').trim();
      const hit = byEn.get(k);
      if (hit && zh) hit.zh = zh;
    }
  }
  return byEn;
}

const report = {};
for (const lv of LEVELS) {
  const byEn = loadLevel(lv);
  const groups = new Map();
  for (const v of byEn.values()) {
    if (!v.zh) continue;
    if (!groups.has(v.zh)) groups.set(v.zh, []);
    groups.get(v.zh).push(v.en);
  }
  const dups = [];
  for (const [zh, words] of groups) if (words.length > 1) dups.push({ zh, words });
  // 只保留同组里需要改的那些（除第一个之外都要改，这里先全列出来）
  fs.writeFileSync(
    path.join(OUT, 'dupzh-' + lv + '.json'),
    JSON.stringify(dups, null, 2) + '\n',
    'utf8',
  );
  report[lv] = { total: byEn.size, dupGroups: dups.length, dups };
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  let sum = 0;
  for (const lv of LEVELS) {
    const r = report[lv];
    sum += r.dupGroups;
    console.log(`${lv.padEnd(8)} ${String(r.total).padStart(4)} 词   重复释义组 ${r.dupGroups}`);
    for (const d of r.dups) console.log(`   「${d.zh}」 ← ${d.words.join(' / ')}`);
  }
  console.log('─'.repeat(60));
  console.log(`合计重复释义组 ${sum}；明细已写入 parts/_used/dupzh-<level>.json`);
}
