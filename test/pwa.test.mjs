// PWA・配信まわりの整合性（サブパス /boki2-app/ で配信されても壊れないこと、版の食い違いがないこと）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../js/version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sw = read('sw.js');
const assets = [...sw.matchAll(/^\s*'(\.\/[^']*)',?$/gm)].map((m) => m[1]);

const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
});

test('バージョンが package.json・js/version.js・sw.js でそろっている', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const swVersion = sw.match(/const VERSION = '([^']+)'/)[1];
  assert.equal(VERSION, pkg);
  assert.equal(swVersion, pkg);
});

test('Service Worker の保存対象がすべて実在する', () => {
  assert.ok(assets.length > 15, '保存対象を読み取れていない');
  for (const a of assets) {
    if (a === './') continue;
    assert.ok(existsSync(join(ROOT, a)), `${a} がありません`);
  }
});

test('アプリのコード・データ・画像はすべて Service Worker の保存対象に入っている（オフラインで欠けない）', () => {
  const need = [...walk('js'), ...walk('css'), ...walk('icons'), ...walk('data'), 'index.html', 'manifest.webmanifest'];
  for (const f of need) assert.ok(assets.includes(`./${f}`), `${f} が sw.js の ASSETS にありません`);
});

test('キャッシュ名にバージョンが入っている', () => {
  assert.match(sw, /const CACHE = `boki2-app-v\$\{VERSION\}`/);
});

test('index.html の参照はすべて相対パス（先頭が / や http でない）', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(m[1].startsWith('./'), `相対パスでない参照：${m[1]}`);
  }
});

test('JS が fetch・import するパスは相対（先頭が / でない）', () => {
  for (const f of walk('js')) {
    const src = read(f);
    for (const m of src.matchAll(/(?:import[^'"]*from\s*|fetch\(\s*|register\(\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${f}: 相対でない参照 ${m[1]}`);
    }
  }
});

test('manifest：相対の start_url / scope、アイコンが実在し、ホーム画面アイコンが用意されている', () => {
  const man = JSON.parse(read('manifest.webmanifest'));
  assert.equal(man.start_url, './');
  assert.equal(man.scope, './');
  assert.equal(man.display, 'standalone');
  for (const i of man.icons) assert.ok(existsSync(join(ROOT, i.src)), `${i.src} がありません`);
  assert.ok(existsSync(join(ROOT, 'icons/apple-touch-icon.png')));
});

test('アイコンは正しい PNG（署名と寸法）', () => {
  for (const [f, size] of [['icons/apple-touch-icon.png', 180], ['icons/icon-192.png', 192], ['icons/icon-512.png', 512]]) {
    const b = readFileSync(join(ROOT, f));
    assert.equal(b.subarray(1, 4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), size);
    assert.equal(b.readUInt32BE(20), size);
  }
});

test('private/（週次レポート）は .gitignore に入っている', () => {
  assert.match(read('.gitignore'), /^private\/$/m);
});

test('祝日データは曜日と整合し、受験日までを覆っている', () => {
  const h = JSON.parse(read('data/holidays.json'));
  const cfg = JSON.parse(read('data/config.json'));
  assert.ok(h.coveredUntil >= cfg.examDate);
  for (const d of Object.keys(h.dates)) {
    assert.ok(d <= h.coveredUntil, `${d} が coveredUntil を超えています`);
  }
  // 成人の日・スポーツの日は月曜
  assert.equal(new Date('2027-01-11T00:00:00Z').getUTCDay(), 1);
  assert.equal(new Date('2026-10-12T00:00:00Z').getUTCDay(), 1);
});

test('Service Worker のインストールは、配信側の古いキャッシュを拾わないよう取り直す（版の混在で起動しなくなるのを防ぐ）', () => {
  assert.match(sw, /cache: 'reload'/);
  assert.doesNotMatch(sw, /addAll\(/);
});
