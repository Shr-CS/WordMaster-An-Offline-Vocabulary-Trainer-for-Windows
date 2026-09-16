/**
 * fix-release-asset.js — 把 Release 附件的名字修好
 *
 * 背景：GitHub 上传附件时文件名里的中文被吞掉了，
 *       WordMaster-1.0.0-免安装版.zip 变成了 WordMaster-1.0.0-.zip。
 *       这里删掉旧附件，用纯 ASCII 文件名重新上传。
 *       用 curl 的 --data-binary @file 发送（不走 shell 参数编码）。
 *
 * 用法：node tools/fix-release-asset.js
 */
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = 'Shr-CS/WordMaster-An-Offline-Vocabulary-Trainer-for-Windows';
const TAG = 'v1.0.0';
const SRC = path.join(ROOT, 'release', 'WordMaster-1.0.0-免安装版.zip');
const NEW_NAME = 'WordMaster-1.0.0-portable-win-x64.zip';
const BAD_NAME = 'WordMaster-1.0.0-.zip';

function gitCredential() {
  return new Promise((resolve) => {
    const p = execFile('git', ['credential', 'fill'], { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve(null);
      const f = {};
      for (const line of String(stdout).split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) f[line.slice(0, i)] = line.slice(i + 1);
      }
      resolve(f);
    });
    p.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

function api(method, url, token, { json, raw, contentType, timeout = 1800000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-w', '\n%{http_code}', '-X', method,
      '-H', 'Authorization: Bearer ' + token,
      '-H', 'User-Agent', '-H', 'dsh-release',
      '-H', 'Accept: application/vnd.github+json'];
    if (json !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(json));
    if (raw !== undefined) {
      if (contentType) args.push('-H', 'Content-Type: ' + contentType);
      args.push('--data-binary', raw);
    }
    args.push(url);
    execFile('curl.exe', args, { timeout, maxBuffer: 1 << 26 }, (err, stdout) => {
      const text = String(stdout || '');
      const nl = text.lastIndexOf('\n');
      if (err) return reject(new Error(`curl 失败(${text.slice(nl + 1).trim()}): ${err.message}`));
      resolve({ code: Number(text.slice(nl + 1).trim()), body: text.slice(0, nl) });
    });
  });
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error('找不到 ' + SRC); process.exit(1); }
  const cred = await gitCredential();
  if (!cred?.password) { console.error('拿不到凭据'); process.exit(1); }
  const token = cred.password;

  const relRes = await api('GET', `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, token);
  if (relRes.code !== 200) { console.error('读 Release 失败 HTTP ' + relRes.code); process.exit(1); }
  const rel = JSON.parse(relRes.body);
  console.log(`Release: ${rel.html_url}  附件 ${rel.assets.length} 个`);

  // 1) 删掉名字坏掉的附件
  for (const a of rel.assets) {
    if (a.name === NEW_NAME) {
      console.log(`已存在正确的附件 ${a.name}，先删掉重传`);
    }
    console.log(`删除附件 ${a.name} (id=${a.id}) ...`);
    const del = await api('DELETE', `https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, token);
    console.log(`  -> HTTP ${del.code}${del.code === 204 ? ' ✓' : ' ' + del.body.slice(0, 200)}`);
  }

  // 2) 用纯 ASCII 名字重传
  const sizeMb = (fs.statSync(SRC).size / 1024 / 1024).toFixed(1);
  const url = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(NEW_NAME)}`;
  console.log(`\n重新上传 ${NEW_NAME}（${sizeMb} MB）...`);
  const up = await api('POST', url, token, { raw: '@' + SRC, contentType: 'application/zip' });
  if (up.code !== 201) {
    console.error(`上传失败 HTTP ${up.code}: ${up.body.slice(0, 400)}`);
    process.exit(1);
  }
  const asset = JSON.parse(up.body);
  console.log(`✓ ${asset.name}  ${(asset.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  下载地址: ${asset.browser_download_url}`);
  console.log(`  旧名字 ${BAD_NAME} 已清除`);
})();
