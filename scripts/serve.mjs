// ローカル確認用の簡易サーバー（依存なし）
// 使い方: node scripts/serve.mjs [ポート番号]  → http://localhost:8080/boki2-app/
// GitHub Pages と同じくサブパス /boki2-app/ で配信し、相対パスの崩れに気づけるようにする
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = '/boki2-app/';
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/boki2-app') {
    res.writeHead(302, { Location: BASE });
    return res.end();
  }
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  const file = normalize(join(ROOT, rel));
  // フォルダの外や private/ は配信しない
  if (!file.startsWith(ROOT) || rel.startsWith('private')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const s = await stat(file);
    const target = s.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}${BASE} で確認できます（止めるときは Ctrl+C）`);
});
