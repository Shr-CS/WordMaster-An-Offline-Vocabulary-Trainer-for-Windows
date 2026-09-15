'use strict';

/**
 * make-icon.js — 生成应用图标
 *
 * 不依赖任何第三方库：自己实现 PNG 编码（zlib + CRC32）和 ICO 封装，
 * 用数学方式绘制一个圆角渐变方块 + 白色字母 W 并做 4 倍超采样抗锯齿。
 *
 * 用法：node tools/make-icon.js
 * 输出：build/icon.png（窗口/任务栏图标）、build/icon.ico（打包用多尺寸图标）
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');

/* ------------------------------ PNG 编码 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** rgba: Uint8Array，长度 = size*size*4 */
function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前面加一个 filter 字节（0 = None）
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4)
      .copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ ICO 封装 ------------------------------ */

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((entry, i) => {
    const base = i * 16;
    dir[base] = entry.size >= 256 ? 0 : entry.size;
    dir[base + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[base + 2] = 0; // palette
    dir[base + 3] = 0; // reserved
    dir.writeUInt16LE(1, base + 4);   // color planes
    dir.writeUInt16LE(32, base + 6);  // bits per pixel
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ------------------------------- 绘制 ------------------------------- */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 点到线段的距离 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = clamp01(t);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 圆角矩形的有符号距离场 */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/** 字母 W 的 4 段折线（归一化坐标，y 向下） */
const W_POINTS = [
  [0.205, 0.295],
  [0.345, 0.735],
  [0.500, 0.455],
  [0.655, 0.735],
  [0.795, 0.295],
];

function drawIcon(size) {
  const SS = 4; // 超采样倍数
  const big = size * SS;
  const acc = new Float32Array(size * size * 4);

  const halfW = big * 0.5 - big * 0.035;
  const halfH = big * 0.5 - big * 0.035;
  const radius = big * 0.23;
  const strokeHalf = big * 0.042;

  // 渐变端点颜色
  const c1 = [0x6d, 0x8b, 0xff];
  const c2 = [0x22, 0xd3, 0xee];

  for (let by = 0; by < big; by++) {
    for (let bx = 0; bx < big; bx++) {
      const px = bx + 0.5;
      const py = by + 0.5;

      const sd = sdRoundRect(px, py, big / 2, big / 2, halfW, halfH, radius);
      const cover = clamp01(0.5 - sd);
      if (cover <= 0) continue;

      // 渐变：沿左上 → 右下
      const t = clamp01((px + py) / (big * 2));
      let r = lerp(c1[0], c2[0], t);
      let g = lerp(c1[1], c2[1], t);
      let b = lerp(c1[2], c2[2], t);

      // 顶部加一点亮光，让图标更有体积感
      const sheen = clamp01(1 - py / (big * 0.62)) * 0.16;
      r = lerp(r, 255, sheen);
      g = lerp(g, 255, sheen);
      b = lerp(b, 255, sheen);

      // 白色 W
      let wCov = 0;
      for (let i = 0; i < W_POINTS.length - 1; i++) {
        const [x1, y1] = W_POINTS[i];
        const [x2, y2] = W_POINTS[i + 1];
        const d = distToSegment(px, py, x1 * big, y1 * big, x2 * big, y2 * big);
        wCov = Math.max(wCov, clamp01((strokeHalf - d) + 0.5));
      }
      // 圆头端点
      for (const [cxNorm, cyNorm] of W_POINTS) {
        const d = Math.hypot(px - cxNorm * big, py - cyNorm * big);
        wCov = Math.max(wCov, clamp01((strokeHalf - d) + 0.5));
      }
      if (wCov > 0) {
        r = lerp(r, 255, wCov);
        g = lerp(g, 255, wCov);
        b = lerp(b, 255, wCov);
      }

      // 累加到目标像素
      const ox = Math.floor(bx / SS);
      const oy = Math.floor(by / SS);
      const idx = (oy * size + ox) * 4;
      acc[idx] += r * cover;
      acc[idx + 1] += g * cover;
      acc[idx + 2] += b * cover;
      acc[idx + 3] += 255 * cover;
    }
  }

  const samples = SS * SS;
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / samples;
    rgba[i * 4 + 3] = Math.round(a);
    if (a > 0) {
      // 颜色需要按覆盖度加权平均，避免边缘发黑
      const w = acc[i * 4 + 3] / 255;
      rgba[i * 4] = Math.round(clamp01(acc[i * 4] / 255 / (w || 1)) * 255);
      rgba[i * 4 + 1] = Math.round(clamp01(acc[i * 4 + 1] / 255 / (w || 1)) * 255);
      rgba[i * 4 + 2] = Math.round(clamp01(acc[i * 4 + 2] / 255 / (w || 1)) * 255);
    }
  }
  return rgba;
}

/* ------------------------------- 主流程 ------------------------------- */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sizes = [256, 128, 64, 48, 32, 16];
  const entries = sizes.map((size) => ({ size, png: encodePNG(drawIcon(size), size) }));

  const bigPNG = entries[0].png;
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), bigPNG);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(entries));

  console.log('图标已生成：');
  console.log('  build/icon.png  ' + (bigPNG.length / 1024).toFixed(1) + ' KB (256x256)');
  const ico = fs.statSync(path.join(OUT_DIR, 'icon.ico')).size;
  console.log('  build/icon.ico  ' + (ico / 1024).toFixed(1) + ' KB (' + sizes.join('/') + ')');
}

main();
