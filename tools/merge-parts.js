'use strict';

/**
 * merge-parts.js — 把 src/data/parts/ 下的分批产出合并进各等级词库
 *
 * 为什么要分批：单个等级要上千词，一次生成质量与长度都不可控。
 * 拆成多个 part 文件后可以并行生成、逐个校验，最后统一去重合并。
 *
 * 支持两类 part 文件（按文件名区分）：
 *
 *   <level>.new01.json   完整新词条
 *                        { "en", "zh", "pos", "ipa", "ex", "exZh" }
 *                        与主文件重复的 en 会被丢弃（主文件优先）
 *
 *   <level>.ex01.json    例句补丁，只补不新增
 *                        { "en", "ex", "exZh" }
 *                        按 en 匹配已有词条，补上例句字段；匹配不到就忽略
 *
 *   <level>.zhfix.json   释义更正补丁（用于消除同义近义词释义完全重复的情况，
 *                        重复释义会让选择题出现两个一样的选项，且 verify 会判失败）
 *                        { "en", "zh" }
 *                        按 en 匹配已有词条，覆盖 zh；匹配不到就忽略
 *
 * 用法：
 *   node tools/merge-parts.js            # 合并
 *   node tools/merge-parts.js --dry-run  # 只看会合并多少，不写文件
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const PARTS_DIR = path.join(DATA_DIR, 'parts');
const LEVELS = ['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts', 'toefl'];
const DRY_RUN = process.argv.includes('--dry-run');

const POS_OK = new Set(['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', 'phr.', 'art.', 'int.']);

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error(`  ✗ ${path.basename(file)} 解析失败：${err.message}`);
    return null;
  }
}

function main() {
  if (!fs.existsSync(PARTS_DIR)) {
    console.log('没有 src/data/parts 目录，无需合并。');
    return;
  }

  const partFiles = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith('.json'));
  if (!partFiles.length) {
    console.log('src/data/parts 目录为空，无需合并。');
    return;
  }

  console.log(`发现 ${partFiles.length} 个 part 文件${DRY_RUN ? '（dry-run，不写文件）' : ''}`);
  console.log('─'.repeat(74));

  let grandAdded = 0;
  let grandPatched = 0;
  const warnings = [];

  for (const level of LEVELS) {
    const mainFile = path.join(DATA_DIR, `${level}.json`);
    const main = readJson(mainFile);
    if (!main) continue;

    const before = main.length;
    /** en 小写 -> 词条；主文件优先，因此先全部装入 */
    const byEn = new Map();
    for (const entry of main) {
      const key = String(entry.en || '').toLowerCase();
      if (key) byEn.set(key, entry);
    }

    const newParts = partFiles.filter((f) => f.startsWith(`${level}.new`)).sort();
    const exParts = partFiles.filter((f) => f.startsWith(`${level}.ex`)).sort();
    const zhParts = partFiles.filter((f) => f.startsWith(`${level}.zhfix`)).sort();

    /* ---------------------- 合并新词 ---------------------- */
    let added = 0;
    let skippedDup = 0;
    let rejected = 0;

    for (const file of newParts) {
      const rows = readJson(path.join(PARTS_DIR, file));
      if (!rows) continue;
      for (const row of rows) {
        const en = String(row.en || '').trim();
        const zh = String(row.zh || '').trim();
        if (!en || !zh) { rejected += 1; continue; }

        const key = en.toLowerCase();
        if (byEn.has(key)) { skippedDup += 1; continue; }

        const pos = String(row.pos || '').trim();
        const ipa = String(row.ipa || '').trim();
        const cleaned = {
          en,
          zh,
          pos: POS_OK.has(pos) ? pos : '',
          ipa,
        };
        if (ipa && !/^\/.+\/$/.test(ipa)) warnings.push(`${level}: ${en} 音标格式异常 ${ipa}`);
        if (!POS_OK.has(pos)) warnings.push(`${level}: ${en} 词性异常「${pos}」`);

        // 例句是可选的，有就带上
        const ex = String(row.ex || '').trim();
        if (ex) {
          cleaned.ex = ex;
          cleaned.exZh = String(row.exZh || '').trim();
        }

        byEn.set(key, cleaned);
        added += 1;
      }
    }

    /* ---------------------- 应用例句补丁 ---------------------- */
    let patched = 0;
    let patchMiss = 0;
    for (const file of exParts) {
      const rows = readJson(path.join(PARTS_DIR, file));
      if (!rows) continue;
      for (const row of rows) {
        const key = String(row.en || '').trim().toLowerCase();
        if (!key) continue;
        const target = byEn.get(key);
        if (!target) { patchMiss += 1; continue; }
        const ex = String(row.ex || '').trim();
        if (!ex) continue;
        target.ex = ex;
        target.exZh = String(row.exZh || '').trim();
        patched += 1;
      }
    }

    const merged = Array.from(byEn.values());
    const withEx = merged.filter((e) => e.ex).length;

    /* ---------------------- 应用释义更正补丁 ---------------------- */
    let zhFixed = 0;
    let zhMiss = 0;
    for (const file of zhParts) {
      const rows = readJson(path.join(PARTS_DIR, file));
      if (!rows) continue;
      for (const row of rows) {
        const key = String(row.en || '').trim().toLowerCase();
        const zh = String(row.zh || '').trim();
        if (!key || !zh) continue;
        const target = byEn.get(key);
        if (!target) { zhMiss += 1; continue; }
        if (target.zh !== zh) zhFixed += 1;
        target.zh = zh;
      }
    }

    console.log(
      `  ${level.padEnd(8)} ${String(before).padStart(4)} → ${String(merged.length).padStart(4)} 词` +
      `  新增 ${String(added).padStart(4)}  重复丢弃 ${String(skippedDup).padStart(3)}` +
      `  例句补丁 ${String(patched).padStart(4)}` +
      (patchMiss ? `  补丁未匹配 ${patchMiss}` : '') +
      (zhFixed ? `  释义更正 ${zhFixed}` : '') +
      (zhMiss ? `  释义未匹配 ${zhMiss}` : '') +
      (rejected ? `  无效 ${rejected}` : '') +
      `  带例句 ${withEx}/${merged.length}`,
    );

    grandAdded += added;
    grandPatched += patched;

    if (!DRY_RUN) {
      fs.writeFileSync(mainFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    }
  }

  console.log('─'.repeat(74));
  console.log(`合计：新增 ${grandAdded} 词，例句补丁 ${grandPatched} 条`);
  if (warnings.length) {
    console.log(`\n提示 ${warnings.length} 条：`);
    for (const w of warnings.slice(0, 15)) console.log('  · ' + w);
    if (warnings.length > 15) console.log(`  · …另有 ${warnings.length - 15} 条`);
  }
  if (!DRY_RUN) console.log('\n合并完成。接着执行：npm run verify && npm run build:data');
}

main();
