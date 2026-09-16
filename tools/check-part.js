/**
 * 校验一个增量分片文件是否符合要求。
 *
 *   node tools/check-part.js <level> <partFile.json>
 *
 * 检查项：
 *   - JSON 可解析、是数组
 *   - 每条包含 en / zh / pos / ipa / ex / exZh 六个字段且非空
 *   - zh 释义长度 ≤ 8 个汉字（避免两个义项粘在一起）
 *   - en 不与正式词库、也不与 parts/_used/<level>.txt 中已用词重复
 *   - ex 例句中确实包含 en（大小写不敏感，允许词形变化时需人工确认——此处只做提示）
 *   - 文件内 en / zh 各自唯一
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'src', 'data');
const level = process.argv[2];
const file = process.argv[3];
if (!level || !file) {
  console.error('用法: node tools/check-part.js <level> <partFile.json>');
  process.exit(2);
}

const errors = [];
const warnings = [];

let arr;
try {
  arr = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('✗ JSON 解析失败: ' + e.message);
  process.exit(1);
}
if (!Array.isArray(arr)) {
  console.error('✗ 顶层不是数组');
  process.exit(1);
}

const usedPath = path.join(DATA, 'parts', '_used', level + '.txt');
const used = fs.existsSync(usedPath)
  ? new Set(fs.readFileSync(usedPath, 'utf8').split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean))
  : new Set();

const seenEn = new Map();
const seenZh = new Map();

arr.forEach((w, i) => {
  const at = '#' + i + ' (' + (w && w.en ? w.en : '?') + ')';
  if (!w || typeof w !== 'object') return errors.push(at + ' 不是对象');
  for (const f of ['en', 'zh', 'pos', 'ipa', 'ex', 'exZh']) {
    if (typeof w[f] !== 'string' || !w[f].trim()) errors.push(at + ' 缺字段或为空: ' + f);
  }
  if (typeof w.en === 'string') {
    const k = w.en.trim().toLowerCase();
    if (used.has(k)) errors.push(at + ' 与已用词重复');
    if (seenEn.has(k)) errors.push(at + ' 文件内 en 重复，首次出现在 #' + seenEn.get(k));
    else seenEn.set(k, i);
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(w.en)) warnings.push(at + ' en 含异常字符');
  }
  if (typeof w.zh === 'string') {
    const z = w.zh.trim();
    const k = z.toLowerCase();
    if (seenZh.has(k)) errors.push(at + ' 文件内 zh 重复，首次出现在 #' + seenZh.get(k));
    else seenZh.set(k, i);
    const han = (z.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (han > 8) warnings.push(at + ' zh 释义偏长（' + han + ' 字）: ' + z);
  }
  if (typeof w.ex === 'string' && typeof w.en === 'string' && w.en.trim()) {
    const stem = w.en.trim().toLowerCase().split(/[\s-]/)[0];
    if (!w.ex.toLowerCase().includes(stem.slice(0, Math.max(4, stem.length - 2)))) {
      warnings.push(at + ' 例句里找不到该词(词形变化?): ' + w.ex.slice(0, 60));
    }
  }
});

console.log('文件: ' + file);
console.log('等级: ' + level + '   条数: ' + arr.length + '   已用词表: ' + (used.size || '（无）'));
console.log('错误 ' + errors.length + ' 条 / 提示 ' + warnings.length + ' 条');
if (errors.length) {
  console.log('\n── 错误 ──');
  for (const m of errors.slice(0, 60)) console.log('  ✗ ' + m);
  if (errors.length > 60) console.log('  … 其余 ' + (errors.length - 60) + ' 条省略');
}
if (warnings.length) {
  console.log('\n── 提示 ──');
  for (const m of warnings.slice(0, 40)) console.log('  ! ' + m);
  if (warnings.length > 40) console.log('  … 其余 ' + (warnings.length - 40) + ' 条省略');
}
process.exit(errors.length ? 1 : 0);
