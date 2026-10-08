// すべての js ファイルが構文として正しいこと。app.js などは起動処理を含み、他のテストでは読み込まれないため、ここで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
});

test('js/ と sw.js のすべてのファイルが構文エラーなく読み込める', () => {
  const files = [...walk('js').filter((f) => f.endsWith('.js')), 'sw.js'];
  assert.ok(files.length > 20);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} に構文エラーがあります：\n${r.stderr}`);
  }
});

test('app.js の論点・講義の経路が、#/topic/ID と #/lesson/ID を正しく見分ける', async () => {
  const src = (await import('node:fs')).readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  const lines = src.split('\n');
  const grab = (key) => {
    const line = lines.find((l) => l.includes(`hash.match(`) && l.includes(key));
    assert.ok(line, `${key} の経路がありません`);
    return new Function(`return ${line.match(/match\((\/.*\/)\)/)[1]}`)();
  };
  assert.deepEqual('#/lesson/c02'.match(grab('lesson')).slice(1), ['c02']);
  assert.deepEqual('#/topic/c02'.match(grab('topic')).slice(1), ['c02']);
  assert.equal('#/topic/c02'.match(grab('lesson')), null);
});
