// 設定画面の「端末間の同期」カード（疑似DOM）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/fake-dom.mjs';

const { syncCard } = await import('../js/views/settings.js');
const byText = (root, tag, text) => root.all((e) => e.tag === tag && e.text.includes(text))[0];

function stubSync(status, calls) {
  return {
    status: () => status,
    configure: (c) => calls.push(['configure', c]),
    clear: () => calls.push(['clear']),
    syncNow: async (r) => { calls.push(['syncNow', r]); return { ok: true, changed: false }; },
  };
}

test('未設定：URLと合言葉の欄が出て、正しくない入力では設定されない', async () => {
  const calls = [];
  const card = syncCard({ sync: stubSync({ configured: false }, calls), refresh() {} });
  assert.equal(card.all((e) => e.tag === 'input').length, 2);
  let msg = '';
  globalThis.alert = (m) => { msg = m; };
  await byText(card, 'button', '設定して同期する').listeners.click[0]({});
  assert.match(msg, /URLと合言葉/);
  assert.equal(calls.length, 0);
});

test('未設定：URLと合言葉を入れて押すと、設定して同期が始まる', async () => {
  const calls = [];
  const card = syncCard({ sync: stubSync({ configured: false }, calls), refresh() {} });
  const [url, token] = card.all((e) => e.tag === 'input');
  url.value = 'https://script.google.com/macros/s/ABC_def-1/exec';
  token.value = 'secret';
  await byText(card, 'button', '設定して同期する').listeners.click[0]({});
  assert.deepEqual(calls[0], ['configure', { url: 'https://script.google.com/macros/s/ABC_def-1/exec', token: 'secret' }]);
  assert.deepEqual(calls[1], ['syncNow', 'setup']);
});

test('設定済み：最後の同期とエラーが出て、今すぐ同期とやめるが使える', async () => {
  const calls = [];
  let refreshed = 0;
  const card = syncCard({ sync: stubSync({ configured: true, lastSyncAt: '2026-11-26T09:05:00', lastError: '通信できませんでした' }, calls), refresh: () => { refreshed += 1; } });
  assert.ok(card.text.includes('最後の同期'));
  assert.ok(card.text.includes('通信できませんでした'));
  await byText(card, 'button', '今すぐ同期').listeners.click[0]({});
  assert.deepEqual(calls[0], ['syncNow', 'manual']);
  assert.equal(refreshed, 1);
  globalThis.confirm = () => false;
  byText(card, 'button', '同期をやめる').listeners.click[0]({});
  assert.equal(calls.some((c) => c[0] === 'clear'), false);
  globalThis.confirm = () => true;
  byText(card, 'button', '同期をやめる').listeners.click[0]({});
  assert.equal(calls.some((c) => c[0] === 'clear'), true);
});

test('記録を保存できない環境では、使えないと表示する', () => {
  const card = syncCard({ sync: null, refresh() {} });
  assert.ok(card.text.includes('この環境では使えません'));
});

test('設定済みでエラーがないとき、画面に「null」という文字が出ない', () => {
  const card = syncCard({ sync: stubSync({ configured: true, lastSyncAt: '2026-11-25T22:25:00', lastError: null }, []), refresh() {} });
  assert.ok(card.text.includes('最後の同期'));
  assert.ok(!card.text.includes('null'));
  assert.ok(card.children.every((c) => c != null));
});
