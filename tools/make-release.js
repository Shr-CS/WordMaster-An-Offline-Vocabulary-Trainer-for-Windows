/**
 * make-release.js — 用 GitHub REST API 建 Release 并上传绿色版 zip
 *
 * 为什么不走 gh CLI 或 git push tag：
 *   本机 github.com:443 连不通（git 协议走这里），但 api.github.com 与
 *   uploads.github.com 正常，所以全程用 REST API。
 *
 * 凭据从 git credential manager 现取，只在内存里用，不落盘、不打印。
 *
 * 用法：
 *   node tools/make-release.js --dry-run    # 只检查，不创建
 *   node tools/make-release.js              # 真正创建 Release 并上传
 */
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = 'Shr-CS/WordMaster-An-Offline-Vocabulary-Trainer-for-Windows';
const TAG = 'v1.0.0';
const NAME = '背单词 WordMaster v1.0.0';
const ZIP = path.join(ROOT, 'release', 'WordMaster-1.0.0-免安装版.zip');
const DRY = process.argv.includes('--dry-run');

const NOTES = [
  '## 背单词 WordMaster v1.0.0',
  '',
  '离线可用的 Windows 桌面背单词应用。7 个词库等级共 **5572 词**，每一条都带英文例句与中文翻译。',
  '',
  '### 主要功能',
  '',
  '- **词库范围自由组合**：小学 200 / 初中 220 / 高中 1031 / 四级 1027 / 六级 1032 / 雅思 1030 / 托福 1032',
  '- **中英双向**：英译中、中译英、中英混合三种出题方向，四选一，键盘 `1~4` / `A~D` 直接作答',
  '- **答对后详细词条卡**：音标、词性、释义、英文例句＋中文翻译、所属词库、复习等级与下次复习日期，单词和例句都能点喇叭朗读；可在「设置 → 答对后展开详细词条」里关闭',
  '- **艾宾浩斯式复习**：今天学的明天一定重考；答对间隔 1→2→4→7→15→30 天，答错退回明天',
  '- **音效与朗读**：Web Audio 实时合成，答对是上行双音、答错是下行滑音；英文可用系统语音朗读',
  '- **白色 / 黑色主题**一键切换，连系统标题栏一起变',
  '- 生词本、学习曲线、连续打卡、数据导出导入备份、错题自动重练',
  '',
  '### 运行要求',
  '',
  'Windows x64，无需安装、无需联网。数据只保存在本机 `%APPDATA%\\WordMaster`。',
  '',
  '### 怎么用',
  '',
  '1. 下载下面的 `WordMaster-1.0.0-免安装版.zip`',
  '2. 解压到任意目录（可以放 U 盘）',
  '3. 双击 `WordMaster\\背单词 WordMaster.exe`',
  '4. 想放桌面就双击同目录的 `创建桌面快捷方式.bat`',
  '',
  '> 完整源码、构建脚本与测试见仓库主页的 README。',
].join('\n');

/* ------------------------------------------------------------------ */

function gitCredential() {
  return new Promise((resolve) => {
    const p = execFile('git', ['credential', 'fill'], { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve(null);
      const fields = {};
      for (const line of String(stdout).split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
      }
      resolve(fields);
    });
    p.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

/** 调 GitHub REST API。body 为对象时走 JSON，为字符串时原样发送（上传二进制用） */
function api(method, urlPath, token, { json, raw, headers = {}, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-s', '-w', '\n%{http_code}',
      '-X', method,
      '-H', 'Authorization: Bearer ' + token,
      '-H', 'User-Agent', '-H', 'dsh-release',
      '-H', 'Accept: application/vnd.github+json',
    ];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (json !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(json));
    if (raw !== undefined) args.push('--data-binary', raw);
    args.push(urlPath.startsWith('http') ? urlPath : 'https://api.github.com' + urlPath);

    execFile('curl.exe', args, { timeout, maxBuffer: 1 << 26 }, (err, stdout) => {
      const text = String(stdout || '');
      const nl = text.lastIndexOf('\n');
      const code = text.slice(nl + 1).trim();
      const body = text.slice(0, nl);
      if (err) return reject(new Error(`curl 失败(${code}): ${err.message}`));
      resolve({ code: Number(code), body });
    });
  });
}

(async () => {
  if (!fs.existsSync(ZIP)) {
    console.error('找不到绿色版压缩包：' + ZIP);
    console.error('请先执行：npm run build:portable 并重新压缩 release\\WordMaster');
    process.exit(1);
  }
  const sizeMb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);

  const cred = await gitCredential();
  if (!cred || !cred.password) {
    console.error('拿不到 GitHub 凭据（git credential fill 无返回）');
    process.exit(1);
  }
  const token = cred.password;
  console.log(`凭据: ${cred.username} / token 前缀 ${token.slice(0, 4)}…（不落盘）`);
  console.log(`仓库: ${REPO}`);
  console.log(`压缩包: ${path.basename(ZIP)}  ${sizeMb} MB`);
  console.log('');

  // 1) 确认仓库可写
  const repo = await api('GET', `/repos/${REPO}`, token);
  if (repo.code !== 200) {
    console.error(`读仓库失败 HTTP ${repo.code}: ${repo.body.slice(0, 300)}`);
    process.exit(1);
  }
  const perms = JSON.parse(repo.body).permissions || {};
  console.log(`仓库权限: ${JSON.stringify(perms)}`);
  if (!perms.push && !perms.admin) {
    console.error('这个 token 没有该仓库的写权限，无法建 Release。');
    process.exit(1);
  }

  // 2) 看是否已存在同 tag 的 Release
  const existing = await api('GET', `/repos/${REPO}/releases/tags/${TAG}`, token);
  if (existing.code === 200) {
    const info = JSON.parse(existing.body);
    console.log(`\n⚠ 已存在 tag ${TAG} 的 Release：${info.html_url}`);
    console.log('  为避免重复创建，本次不做任何修改。要重传请先在网页上删掉那个 Release。');
    process.exit(0);
  }
  console.log(`tag ${TAG} 暂无 Release（HTTP ${existing.code}），可以创建。`);

  if (DRY) {
    console.log('\n--dry-run：检查通过，未创建任何东西。');
    return;
  }

  // 3) 创建 Release（自动建 tag，指向默认分支 HEAD）
  console.log('\n创建 Release ...');
  const created = await api('POST', `/repos/${REPO}/releases`, token, {
    json: {
      tag_name: TAG,
      target_commitish: 'main',
      name: NAME,
      body: NOTES,
      draft: false,
      prerelease: false,
    },
  });
  if (created.code !== 201) {
    console.error(`创建失败 HTTP ${created.code}: ${created.body.slice(0, 500)}`);
    process.exit(1);
  }
  const rel = JSON.parse(created.body);
  console.log(`✓ Release 已创建：${rel.html_url}`);
  console.log(`  tag: ${rel.tag_name}`);

  // 4) 上传 zip 作为附件
  const assetName = path.basename(ZIP);
  const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(assetName)}`;
  console.log(`\n上传附件 ${assetName}（${sizeMb} MB，请稍候）...`);
  const up = await api('POST', uploadUrl, token, {
    raw: '@' + ZIP,
    headers: { 'Content-Type': 'application/zip' },
    timeout: 1800000,
  });
  if (up.code !== 201) {
    console.error(`上传失败 HTTP ${up.code}: ${up.body.slice(0, 500)}`);
    console.error(`Release 本身已建好，可以手动把 ${assetName} 拖到 ${rel.html_url}`);
    process.exit(1);
  }
  const asset = JSON.parse(up.body);
  console.log(`✓ 附件已上传：${asset.name}  ${(asset.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  下载地址：${asset.browser_download_url}`);
  console.log(`\n完成 → ${rel.html_url}`);
})();
