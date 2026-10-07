// アイコン（PNG）を依存なしで生成する。使い方: node scripts/make-icons.mjs
// 青地に、開いた本とチェックの図柄。iOS のホーム画面用(180)と PWA 用(192/512)を icons/ に出す
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
const BG = [0x1f, 0x4e, 0x79];
const PAGE = [0xff, 0xff, 0xff];
const LINE = [0xb8, 0xcc, 0xe0];
const CHECK = [0x1c, 0x9a, 0x6e];

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
// 線分からの距離（チェックマーク用）
const distSeg = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};

// 座標は 0〜1。上に描いたものが手前
function colorAt(x, y) {
  let c = BG;
  // 左右のページ（中央に細い背表紙の隙間）
  if (inRect(x, y, 0.16, 0.26, 0.485, 0.74) || inRect(x, y, 0.515, 0.26, 0.84, 0.74)) c = PAGE;
  // 本文の行
  for (const [x0, x1] of [[0.21, 0.44], [0.56, 0.79]]) {
    for (const ly of [0.34, 0.42, 0.5]) if (inRect(x, y, x0, ly, x1, ly + 0.025)) c = LINE;
  }
  // チェックマーク（右下のページ上）
  if (distSeg(x, y, 0.58, 0.6, 0.64, 0.67) < 0.022 || distSeg(x, y, 0.64, 0.67, 0.76, 0.54) < 0.022) c = CHECK;
  return c;
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 3; // 3x3 のスーパーサンプリングで縁をなめらかに
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const n = SS * SS;
      row[1 + px * 3] = Math.round(r / n); row[2 + px * 3] = Math.round(g / n); row[3 + px * 3] = Math.round(b / n);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit・RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(OUT + name, png(size));
  console.log(`icons/${name} (${size}px)`);
}
