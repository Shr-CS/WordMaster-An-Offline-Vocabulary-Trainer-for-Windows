'use strict';

/**
 * verify-words.js — 词库质量校验
 * 逐条检查 7 个等级的 JSON 源文件，任何硬性错误都会让进程以非零码退出。
 *
 * 用法：node tools/verify-words.js
 */

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = [
  { id: 'primary', name: '小学', min: 150 },
  { id: 'junior', name: '初中', min: 150 },
  { id: 'senior', name: '高中', min: 950 },
  { id: 'cet4', name: '四级', min: 950 },
  { id: 'cet6', name: '六级', min: 950 },
  { id: 'ielts', name: '雅思', min: 950 },
  { id: 'toefl', name: '托福', min: 950 },
];

const POS_OK = new Set(['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', 'phr.', 'art.', 'int.']);
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

const errors = [];
const warnings = [];

function check(level) {
  const file = path.join(DATA_DIR, `${level.id}.json`);
  if (!fs.existsSync(file)) {
    errors.push(`[${level.id}] 文件不存在：${file}`);
    return null;
  }

  const text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) errors.push(`[${level.id}] 文件带 BOM，可能导致 JSON.parse 失败`);

  let rows;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    errors.push(`[${level.id}] JSON 解析失败：${err.message}`);
    return null;
  }

  if (!Array.isArray(rows)) {
    errors.push(`[${level.id}] 顶层不是数组`);
    return null;
  }
  if (rows.length < level.min) {
    errors.push(`[${level.id}] 词条数 ${rows.length} 少于预期的 ${level.min}`);
  }

  const enSet = new Map();
  const zhSet = new Map();
  let missingIpa = 0;
  let badIpa = 0;
  let badPos = 0;

  rows.forEach((row, i) => {
    const at = `[${level.id}#${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${at} 不是对象`);
      return;
    }
    for (const field of ['en', 'zh', 'pos', 'ipa', 'ex', 'exZh']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) {
        errors.push(`${at} 缺少非空文本字段：${field}`);
      } else if (row[field] !== row[field].trim() || row[field].includes('\uFFFD')) {
        errors.push(`${at} ${field} 含首尾空白或损坏字符`);
      }
    }
    const en = String(row.en || '').trim();
    const zh = String(row.zh || '').trim();
    const pos = String(row.pos || '').trim();
    const ipa = String(row.ipa || '').trim();

    if (!en) errors.push(`${at} 缺少 en`);
    if (!zh) errors.push(`${at} 缺少 zh`);
    if (!en || !zh) return;

    if (enSet.has(en.toLowerCase())) errors.push(`${at} 英文重复：${en}（首次出现于 #${enSet.get(en.toLowerCase())}）`);
    else enSet.set(en.toLowerCase(), i);

    // 同义词允许共用释义；出题器会排除含相同释义的干扰项。
    if (zhSet.has(zh)) warnings.push(`${at} 共用释义：${zh}（首次出现于 #${zhSet.get(zh)}）`);
    else zhSet.set(zh, i);

    if (zh.length > 12) warnings.push(`${at} 释义偏长（${zh.length} 字）：${zh}`);
    if (/[;；]/.test(zh)) warnings.push(`${at} 释义含分号，可能影响选择题可读性：${zh}`);
    if (/^(n|v|adj|adv)\./.test(zh)) warnings.push(`${at} 释义里混入了词性：${zh}`);

    if (!POS_OK.has(pos)) {
      badPos += 1;
      errors.push(`${at} 词性无效：${pos}`);
    }

    if (!ipa) missingIpa += 1;
    else if (!/^\/.+\/$/.test(ipa)) {
      badIpa += 1;
      errors.push(`${at} 音标格式无效：${ipa}`);
    }
  });

  return {
    ...level,
    count: rows.length,
    uniqueEn: enSet.size,
    uniqueZh: zhSet.size,
    missingIpa,
    badIpa,
    badPos,
  };
}

const results = LEVELS.map(check).filter(Boolean);

console.log('词库校验报告');
console.log('─'.repeat(64));
let total = 0;
for (const r of results) {
  total += r.count;
  const flags = [];
  if (r.missingIpa) flags.push(`缺音标 ${r.missingIpa}`);
  if (r.badIpa) flags.push(`音标格式异常 ${r.badIpa}`);
  if (r.badPos) flags.push(`词性异常 ${r.badPos}`);
  console.log(
    `  ${r.name.padEnd(4)} ${r.id.padEnd(8)} ${String(r.count).padStart(4)} 词  ` +
    `唯一英文 ${String(r.uniqueEn).padStart(4)}  唯一释义 ${String(r.uniqueZh).padStart(4)}` +
    (flags.length ? `  ⚠ ${flags.join('、')}` : '  ✓'),
  );
}
console.log('─'.repeat(64));
console.log(`  合计 ${total} 词`);

if (warnings.length) {
  console.log(`\n提示 ${warnings.length} 条（不影响运行）：`);
  for (const w of warnings.slice(0, 20)) console.log('  · ' + w);
  if (warnings.length > 20) console.log(`  · …另有 ${warnings.length - 20} 条`);
}

if (errors.length) {
  console.error(`\n发现 ${errors.length} 个错误：`);
  for (const e of errors.slice(0, 40)) console.error('  ✗ ' + e);
  if (errors.length > 40) console.error(`  ✗ …另有 ${errors.length - 40} 个`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过 ✓');
}
