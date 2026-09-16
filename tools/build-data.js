'use strict';

/**
 * build-data.js — 把 src/data/*.json 汇总成渲染进程可直接 <script> 加载的 words.js
 *
 * 为什么要这一步：
 *   应用以 file:// 协议加载页面，浏览器安全策略禁止 file:// 下的 fetch/XHR 读取本地 JSON，
 *   也不允许 ES module 跨文件导入。把词库打包成一个普通脚本是最稳的做法。
 *
 * 用法：node tools/build-data.js
 */

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = ['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts', 'toefl'];
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const OUT_FILE = path.join(DATA_DIR, 'words.js');

/** 归一化中文释义，用于跨等级查重时判断「是不是同一个意思」 */
const normZh = (text) => text.replace(/[\s\u3000·、，,。.；;（）()]/g, '');

function readLevel(id) {
  const file = path.join(DATA_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return { id, rows: [], missing: true };

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${id}.json 顶层不是数组`);

  const rows = [];
  const seenEn = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const en = String(item.en || '').trim();
    const zh = String(item.zh || '').trim();
    if (!en || !zh) continue;
    const key = en.toLowerCase();
    if (seenEn.has(key)) continue; // 同等级内英文重复，保留第一条
    seenEn.add(key);

    // 例句是可选的：老版词库没有这两个字段，有就带上（答对后的详细词条卡要用）
    const ex = String(item.ex || '').trim();
    const row = {
      en,
      zh,
      pos: String(item.pos || '').trim(),
      ipa: String(item.ipa || '').trim(),
    };
    if (ex) {
      row.ex = ex;
      const exZh = String(item.exZh || '').trim();
      if (exZh) row.exZh = exZh;
    }

    rows.push(row);
  }
  return { id, rows, missing: false, rawCount: raw.length };
}

function main() {
  const banks = {};
  const report = [];
  let total = 0;

  for (const id of LEVELS) {
    const { rows, missing, rawCount } = readLevel(id);
    banks[id] = rows;
    total += rows.length;
    const withEx = rows.filter((r) => r.ex).length;
    report.push(
      missing
        ? `  ${id.padEnd(8)} 缺失（跳过）`
        : `  ${id.padEnd(8)} ${String(rows.length).padStart(4)} 词  带例句 ${String(withEx).padStart(4)}` +
          (rawCount !== rows.length ? `  （源数据 ${rawCount}，去重后 ${rows.length}）` : ''),
    );
  }

  // 统计整个词库里的重复释义，仅作提示（不同等级出现同义属正常现象）
  const zhMap = new Map();
  let crossDup = 0;
  for (const [id, rows] of Object.entries(banks)) {
    for (const row of rows) {
      const key = normZh(row.zh);
      if (zhMap.has(key)) crossDup += 1;
      else zhMap.set(key, `${id}:${row.en}`);
    }
  }

  const banner = [
    '/* ------------------------------------------------------------------ */',
    '/* 本文件由 tools/build-data.js 自动生成，请勿手工编辑。               */',
    '/* 词库源文件：src/data/*.json     重新生成：node tools/build-data.js  */',
    '/* ------------------------------------------------------------------ */',
  ].join('\n');

  const body = Object.entries(banks)
    .map(([id, rows]) => `  ${JSON.stringify(id)}: ${JSON.stringify(rows)}`)
    .join(',\n');

  fs.writeFileSync(OUT_FILE, `${banner}\nwindow.WM_DATA = {\n${body}\n};\n`, 'utf8');

  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log('词库构建完成');
  console.log(report.join('\n'));
  console.log(`  ${'合计'.padEnd(7)} ${String(total).padStart(4)} 词`);
  console.log(`  跨等级重复释义 ${crossDup} 条（不影响使用：出题时按等级隔离，且干扰项会去重）`);
  console.log(`  输出 ${path.relative(process.cwd(), OUT_FILE)}  (${size} KB)`);

  if (total === 0) {
    console.error('没有生成任何词条，请检查 src/data 目录。');
    process.exitCode = 1;
  }
}

main();
