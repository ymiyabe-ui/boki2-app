// 端末間の同期：2台の端末と、サーバー（gas/Code.js）を使った通し確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STORAGE_KEY } from '../js/store.js';
import { createSync, parseSetupHash, readConfig, SYNC_KEY } from '../js/sync.js';
import { makeFakeGas } from './helpers/fake-gas.mjs';

const INTERVALS = [1, 3, 7];
const URL_ = 'https://script.google.com/macros/s/TESTID/exec';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; };
const clock = (start) => { let t = Date.parse(start); return () => new Date((t += 1000)); };

/** 端末1台ぶん（記録の保存先・設定の保存先・同期）。予約されたタイマーは、手動で動かす */
function device(gas, start, { token = gas.token, fetchImpl = gas.fetchImpl } = {}) {
  const storage = mem();
  const now = clock(start);
  const store = createStore(storage, { now }).load();
  const timers = [];
  const sync = createSync({ store, storage, fetchImpl, intervals: INTERVALS, now, setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer: () => {} });
  store.onChange = () => sync.schedule();
  if (token) sync.configure({ url: URL_, token });
  return { storage, store, sync, timers, now };
}
const q = (id) => ({ id, topicId: 'c01', rev: 1, targetSec: 60 });
const serverData = (gas) => gas.post({ token: gas.token, op: 'get' }).data;

test('設定リンクは、Google Apps Script のURLだけ受け付ける', () => {
  assert.deepEqual(parseSetupHash(`#/setup-sync?u=${encodeURIComponent(URL_)}&t=abc123`), { url: URL_, token: 'abc123' });
  assert.equal(parseSetupHash(`#/setup-sync?u=${encodeURIComponent('https://example.com/exec')}&t=abc`), null);
  assert.equal(parseSetupHash(`#/setup-sync?u=${encodeURIComponent(URL_)}`), null);
  assert.equal(parseSetupHash('#/settings'), null);
});

test('サーバー：合言葉が違えば断る・版番号が違えば書き込めない・1つ前の状態が残る', () => {
  const gas = makeFakeGas();
  assert.deepEqual(gas.post({ token: 'wrong', op: 'get' }), { ok: false, error: 'auth' });
  assert.deepEqual(gas.post({ op: 'get' }), { ok: false, error: 'auth' });
  const first = gas.post({ token: gas.token, op: 'get' });
  assert.deepEqual([first.ok, first.rev, first.data], [true, 0, null]);
  assert.equal(gas.post({ token: gas.token, op: 'put', baseRev: 5, data: { sessions: [], attempts: [] } }).conflict, true);
  assert.deepEqual(gas.post({ token: gas.token, op: 'put', baseRev: 0, data: { sessions: [], attempts: [] } }), { ok: true, rev: 1 });
  assert.deepEqual(gas.post({ token: gas.token, op: 'put', baseRev: 1, data: { sessions: [{ id: 'x' }], attempts: [] } }), { ok: true, rev: 2 });
  assert.equal(serverData(gas).sessions.length, 1);
  assert.equal(gas.post({ token: gas.token, op: 'put', baseRev: 2, data: { nope: 1 } }).error, 'bad-request');
  const prev = [...gas.files.values()].find((f) => f.name === 'boki2-app-sync.prev.json');
  assert.equal(JSON.parse(prev.content).rev, 1);
  assert.match(gas.link, /#\/setup-sync\?u=https%3A%2F%2Fscript\.google\.com.*&t=/);
});

test('2台の端末：片方の記録がもう片方に届き、両方の記録がそろう', async () => {
  const gas = makeFakeGas();
  const A = device(gas, '2026-11-26T09:00:00Z');
  const B = device(gas, '2026-11-26T12:00:00Z');
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 90, topicId: 'c01' });
  A.store.recordAnswer({ q: q('c01-001'), correct: false, sec: 40, intervals: INTERVALS });
  A.store.setTopicRead('c01', true);
  assert.equal((await A.sync.syncNow()).ok, true);

  assert.equal((await B.sync.syncNow()).changed, true); // 空の端末が、記録を受け取る
  assert.equal(B.store.data.sessions.length, 1);
  assert.equal(B.store.data.attempts.length, 1);
  assert.ok(B.store.data.topicMarks.c01);
  assert.equal(B.store.data.reviewQueue.length, 1); // 再出題の予定も届く

  B.store.addSession({ date: '2026-11-26', slot: 'noon', minutes: 30, topicId: 'c02' });
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.equal(A.store.data.sessions.length, 2);
  assert.deepEqual(A.store.data.sessions.map((s) => s.id).sort(), B.store.data.sessions.map((s) => s.id).sort());
});

test('消した記録が、もう片方の端末でも消える', async () => {
  const gas = makeFakeGas();
  const A = device(gas, '2026-11-26T09:00:00Z');
  const B = device(gas, '2026-11-26T12:00:00Z');
  const s = A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 90 });
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(B.store.data.sessions.length, 1);
  A.store.deleteSession(s.id);
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(B.store.data.sessions.length, 0);
  await A.sync.syncNow();
  assert.equal(A.store.data.sessions.length, 0);
});

test('2台が同時に書こうとして衝突しても、やり直して、両方の記録が残る', async () => {
  const gas = makeFakeGas();
  let B;
  let fired = false;
  const racing = async (url, opts) => {
    const res = await gas.fetchImpl(url, opts);
    if (!fired && JSON.parse(opts.body).op === 'get') { fired = true; await B.sync.syncNow(); } // A が取った直後に、B が先に書く
    return res;
  };
  const A = device(gas, '2026-11-26T09:00:00Z', { fetchImpl: racing });
  B = device(gas, '2026-11-26T12:00:00Z');
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  B.store.addSession({ date: '2026-11-26', slot: 'noon', minutes: 20 });
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(A.store.data.sessions.length, 2);
  await B.sync.syncNow();
  assert.equal(B.store.data.sessions.length, 2);
});

test('通信できないときは記録をそのままにして、あとで同期できる', async () => {
  const gas = makeFakeGas();
  let offline = true;
  const flaky = async (url, opts) => { if (offline) throw new Error('offline'); return gas.fetchImpl(url, opts); };
  const A = device(gas, '2026-11-26T09:00:00Z', { fetchImpl: flaky });
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  assert.equal((await A.sync.syncNow()).ok, false);
  assert.match(A.sync.status().lastError, /通信できませんでした/);
  assert.equal(A.store.data.sessions.length, 1);
  offline = false;
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(A.sync.status().lastError, null);
  assert.equal(serverData(gas).sessions.length, 1);
});

test('合言葉が違うと、記録を変えずに、設定のやり直しを促す', async () => {
  const gas = makeFakeGas();
  const A = device(gas, '2026-11-26T09:00:00Z', { token: 'wrong-token' });
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  assert.equal((await A.sync.syncNow()).ok, false);
  assert.match(A.sync.status().lastError, /合言葉が違います/);
  assert.equal(A.store.data.sessions.length, 1);
});

test('同期の途中で記録が増えても失われず、もう一度の同期が予約される', async () => {
  const gas = makeFakeGas();
  let A;
  let added = false;
  const slow = async (url, opts) => {
    const res = await gas.fetchImpl(url, opts);
    if (!added && JSON.parse(opts.body).op === 'get') { added = true; A.store.addSession({ date: '2026-11-26', slot: 'night', minutes: 5 }); }
    return res;
  };
  A = device(gas, '2026-11-26T09:00:00Z', { fetchImpl: slow });
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  A.timers.length = 0;
  await A.sync.syncNow();
  assert.equal(A.store.data.sessions.length, 2);
  assert.ok(A.timers.length > 0); // 続きの同期が予約されている
  await A.sync.syncNow();
  assert.equal(serverData(gas).sessions.length, 2);
});

test('初めての同期の前に控えが残り、同期をやめると設定が消える', async () => {
  const gas = makeFakeGas();
  const A = device(gas, '2026-11-26T09:00:00Z');
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  await A.sync.syncNow();
  assert.ok(A.storage.has(`${STORAGE_KEY}:pre-sync`));
  assert.ok(readConfig(A.storage));
  A.sync.clear();
  assert.equal(readConfig(A.storage), null);
  assert.equal(A.storage.has(SYNC_KEY), false);
  assert.equal(A.sync.isConfigured(), false);
  assert.deepEqual(await A.sync.syncNow(), { ok: false, skipped: 'off' });
});

test('記録を変えたときは同期が予約され、同期の結果の取り込みでは予約されない', async () => {
  const gas = makeFakeGas();
  const A = device(gas, '2026-11-26T09:00:00Z');
  const B = device(gas, '2026-11-26T12:00:00Z');
  A.store.addSession({ date: '2026-11-26', slot: 'morning', minutes: 10 });
  assert.ok(A.timers.length > 0);
  await A.sync.syncNow();
  B.timers.length = 0;
  await B.sync.syncNow(); // 記録を受け取って保存するが、そのせいで、さらに同期を予約したりしない
  assert.equal(B.timers.length, 0);
});
