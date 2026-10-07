// バージョンを package.json・js/version.js・sw.js にそろえて書き換える
// 使い方: node scripts/set-version.mjs 0.1.0   （Service Worker のキャッシュ名が変わり、スマホに更新通知が出る）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  console.error('使い方: node scripts/set-version.mjs 0.1.0');
  process.exit(1);
}
const p = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const edit = (rel, fn) => writeFileSync(p(rel), fn(readFileSync(p(rel), 'utf8')));

edit('package.json', (s) => s.replace(/"version":\s*"[^"]*"/, `"version": "${v}"`));
edit('js/version.js', (s) => s.replace(/VERSION = '[^']*'/, `VERSION = '${v}'`));
edit('sw.js', (s) => s.replace(/const VERSION = '[^']*'/, `const VERSION = '${v}'`));
console.log(`バージョンを ${v} にしました（package.json / js/version.js / sw.js）`);
