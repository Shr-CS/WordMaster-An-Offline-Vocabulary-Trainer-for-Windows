/**
 * 汇总某一等级已经用过的全部单词（正式词库 + parts/ 下的所有增量分片），
 * 输出到 src/data/parts/_used/<level>.txt，供补充分片生成时排除。
 *
 *   node tools/mk-used-list.js
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'src', 'data');
const PARTS = path.join(DATA, 'parts');
const OUT = path.join(PARTS, '_used');
const LEVELS = ['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts', 'toefl'];

fs.mkdirSync(OUT, { recursive: true });

const report = [];
for (const lv of LEVELS) {
  const used = new Map(); // key -> 来源
  const add = (w, src) => {
    const k = String(w || '').trim().toLowerCase();
    if (!k) return;
    if (!used.has(k)) used.set(k, src);
  };
  const basePath = path.join(DATA, lv + '.json');
  if (fs.existsSync(basePath)) {
    for (const w of JSON.parse(fs.readFileSync(basePath, 'utf8'))) add(w.en, lv + '.json');
  }
  const files = fs.existsSync(PARTS)
    ? fs.readdirSync(PARTS).filter((f) => f.startsWith(lv + '.') && f.endsWith('.json')).sort()
    : [];
  for (const f of files) {
    for (const w of JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8'))) add(w.en, f);
  }
  const list = [...used.keys()].sort();
  fs.writeFileSync(path.join(OUT, lv + '.txt'), list.join('\n') + '\n', 'utf8');
  report.push('  ' + lv.padEnd(8) + ' 已用 ' + String(list.length).padStart(4) + ' 词  → parts/_used/' + lv + '.txt');
}

console.log('已写出排除表：');
console.log(report.join('\n'));
