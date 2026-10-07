import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_VERSION, STORAGE_KEY, backupDueDays, createStore, migrate } from '../js/store.js';

class FakeStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}
const fixedNow = (iso) => () => new Date(iso);
const open = (storage, now = fixedNow('2026-10-07T12:00:00')) => createStore(storage, { now }).load();

test('初回は空で始まり、書き込むまで保存されない', () => {
  const st = new FakeStorage();
  const s = open(st);
  assert.equal(s.status, 'new');
  assert.equal(st.getItem(STORAGE_KEY), null);
  s.addSession({ date: '2026-10-07', slot: 'noon', minutes: 30, topicId: 'c01', kind: 'minitest' });
  assert.notEqual(st.getItem(STORAGE_KEY), null);
});

test('保存した記録は開き直しても残る（時間・解答・読了チェック）', () => {
  const st = new FakeStorage();
  const s1 = open(st);
  s1.addSession({ date: '2026-10-07', slot: 'morning', minutes: 90, topicId: 'c02' });
  s1.addAttempt({ topicId: 'c02', score: 0.5, inTime: false, ref: { book: '本A', page: '12', no: '3' } });
  s1.setTopicRead('c02', true);
  const s2 = open(st);
  assert.equal(s2.status, 'ok');
  assert.equal(s2.data.sessions.length, 1);
  assert.equal(s2.data.sessions[0].minutes, 90);
  assert.equal(s2.data.attempts[0].score, 0.5);
  assert.equal(s2.data.attempts[0].ref.no, '3');
  assert.ok(s2.data.topicMarks.c02);
  s2.setTopicRead('c02', false);
  assert.equal(open(st).data.topicMarks.c02, undefined);
});

test('削除は対象だけを消す', () => {
  const s = open(new FakeStorage());
  const a = s.addSession({ date: '2026-10-07', slot: 'night', minutes: 10 });
  const b = s.addSession({ date: '2026-10-07', slot: 'night', minutes: 20 });
  s.deleteSession(a.id);
  assert.deepEqual(s.data.sessions.map((x) => x.id), [b.id]);
});

test('アプリ更新で記録が消えない：旧形式（schemaVersionなし）を現行へ移行しても全件残る', () => {
  const legacy = {
    sessions: [{ date: '2026-10-06', slot: 'night', minutes: 45, topicId: 'c01' }], // id なし
    attempts: [{ ts: '2026-10-06T12:00:00Z', date: '2026-10-06', topicId: 'c01', score: 1 }],
    topicMarks: { c01: { readDate: '2026-10-05' } },
  };
  const st = new FakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const s = open(st);
  assert.equal(s.status, 'migrated');
  assert.equal(s.data.schemaVersion, CURRENT_VERSION);
  assert.equal(s.data.sessions.length, 1);
  assert.equal(s.data.sessions[0].minutes, 45);
  assert.ok(s.data.sessions[0].id, 'IDが振られる');
  assert.equal(s.data.attempts.length, 1);
  assert.deepEqual(s.data.reviewQueue, []);
  assert.ok(s.data.topicMarks.c01);
  // 移行後の形が保存され、移行前の控えも残る
  assert.equal(JSON.parse(st.getItem(STORAGE_KEY)).schemaVersion, CURRENT_VERSION);
  assert.equal(st.getItem(`${STORAGE_KEY}:pre-v0`), JSON.stringify(legacy));
});

test('将来のバージョン追加を想定した移行の連鎖：v1→v2 を足しても既存の記録が残る', () => {
  const v1 = { schemaVersion: 1, sessions: [{ id: 's1', minutes: 10 }], attempts: [], topicMarks: {}, meta: {} };
  const migrations = {
    0: (d) => d,
    1: (d) => ({ ...d, sessions: d.sessions.map((s) => ({ ...s, tags: [] })), newField: 'x' }),
  };
  const out = migrate(v1, migrations, 2);
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.sessions[0].minutes, 10);
  assert.deepEqual(out.sessions[0].tags, []);
  // 元のオブジェクトは変更しない
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.sessions[0].tags, undefined);
  // 移行手順が欠けていれば止まる（黙って壊さない）
  assert.throws(() => migrate(v1, { 0: (d) => d }, 2), /移行手順/);
});

test('新しいバージョンのデータは読み取り専用で守り、上書きしない', () => {
  const future = JSON.stringify({ schemaVersion: CURRENT_VERSION + 1, sessions: [{ id: 'x', minutes: 5 }], attempts: [] });
  const st = new FakeStorage({ [STORAGE_KEY]: future });
  const s = open(st);
  assert.equal(s.status, 'too-new');
  assert.equal(s.readOnly, true);
  assert.throws(() => s.addSession({ date: '2026-10-07', slot: 'noon', minutes: 1 }));
  assert.equal(st.getItem(STORAGE_KEY), future);
});

test('壊れたデータは別キーに退避して、新しく始める', () => {
  const st = new FakeStorage({ [STORAGE_KEY]: '{broken' });
  const s = open(st);
  assert.equal(s.status, 'corrupt');
  assert.equal(s.data.sessions.length, 0);
  const saved = st.keys().find((k) => k.startsWith(`${STORAGE_KEY}:corrupt:`));
  assert.ok(saved);
  assert.equal(st.getItem(saved), '{broken');
});

test('タイマー：開始時刻から経過を計算し、停止で勉強時間に記録する', () => {
  const st = new FakeStorage();
  let now = new Date(2026, 9, 7, 7, 0, 0);
  const s = createStore(st, { now: () => now }).load();
  s.startTimer({ slot: 'morning', topicId: 'c01', kind: 'input' });
  assert.throws(() => s.startTimer({ slot: 'morning' }), /すでに/);
  now = new Date(2026, 9, 7, 8, 12, 20); // 1時間12分20秒後
  // アプリを閉じて開き直しても、タイマーは動き続けている
  const reopened = createStore(st, { now: () => now }).load();
  assert.ok(reopened.data.timer);
  assert.equal(Math.round(reopened.timerElapsedMs() / 1000), 4340);
  const rec = reopened.stopTimer();
  assert.equal(rec.minutes, 72);
  assert.equal(rec.date, '2026-10-07');
  assert.equal(rec.source, 'timer');
  assert.equal(reopened.data.timer, null);
  assert.equal(open(st).data.sessions.length, 1);
});

test('タイマー：数秒で止めても最低1分、日をまたいでも開始日の記録にする', () => {
  const st = new FakeStorage();
  let now = new Date(2026, 9, 7, 23, 50, 0);
  const s = createStore(st, { now: () => now }).load();
  s.startTimer({ slot: 'night' });
  now = new Date(2026, 9, 8, 0, 20, 0);
  const rec = s.stopTimer();
  assert.equal(rec.minutes, 30);
  assert.equal(rec.date, '2026-10-07');
  s.startTimer({ slot: 'night' });
  now = new Date(now.getTime() + 5000);
  assert.equal(s.stopTimer().minutes, 1);
});

test('バックアップを書き出して、別の端末（空の状態）に取り込める', () => {
  const a = open(new FakeStorage());
  a.addSession({ date: '2026-10-07', slot: 'noon', minutes: 60, topicId: 'c03' });
  a.addAttempt({ topicId: 'c03', score: 1, ref: { book: '本B', page: '5', no: '1' } });
  a.setTopicRead('c03', true);
  const text = a.exportJson();
  const stB = new FakeStorage();
  const b = open(stB);
  const r = b.parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { sessions: 1, attempts: 1, marks: 1 });
  b.replaceAll(r.data);
  const reopened = open(stB);
  assert.equal(reopened.data.sessions[0].minutes, 60);
  assert.equal(reopened.data.attempts[0].ref.book, '本B');
  assert.ok(reopened.data.topicMarks.c03);
});

test('取り込みは置き換え前の内容を控えとして残す', () => {
  const st = new FakeStorage();
  const s = open(st);
  s.addSession({ date: '2026-10-07', slot: 'noon', minutes: 11 });
  const before = st.getItem(STORAGE_KEY);
  const other = open(new FakeStorage());
  other.addSession({ date: '2026-10-08', slot: 'noon', minutes: 22 });
  s.replaceAll(s.parseBackup(other.exportJson()).data);
  assert.equal(st.getItem(`${STORAGE_KEY}:pre-import`), before);
  assert.equal(s.data.sessions[0].minutes, 22);
});

test('バックアップに旧形式が含まれていても取り込める', () => {
  const s = open(new FakeStorage());
  const r = s.parseBackup(JSON.stringify({ sessions: [{ date: '2026-10-01', slot: 'night', minutes: 5 }], attempts: [] }));
  assert.equal(r.ok, true);
  assert.equal(r.data.schemaVersion, CURRENT_VERSION);
  assert.equal(r.counts.sessions, 1);
});

test('関係のないファイルや壊れたファイルは取り込まない', () => {
  const s = open(new FakeStorage());
  assert.equal(s.parseBackup('これはJSONではない').ok, false);
  assert.equal(s.parseBackup('{"hello":1}').ok, false);
  assert.equal(s.parseBackup('[1,2,3]').ok, false);
  const tooNew = s.parseBackup(JSON.stringify({ sessions: [], attempts: [], schemaVersion: CURRENT_VERSION + 5 }));
  assert.equal(tooNew.ok, false);
});

test('バックアップを促す：記録がなければ不要、未バックアップまたは7日以上で促す', () => {
  const s = open(new FakeStorage(), fixedNow('2026-10-07T12:00:00'));
  assert.equal(backupDueDays(s.data, '2026-10-07'), null);
  s.addSession({ date: '2026-10-07', slot: 'noon', minutes: 10 });
  assert.equal(backupDueDays(s.data, '2026-10-07'), Infinity);
  s.markBackedUp();
  assert.equal(backupDueDays(s.data, '2026-10-07'), null);
  assert.equal(backupDueDays(s.data, '2026-10-13'), null); // 6日後
  assert.equal(backupDueDays(s.data, '2026-10-14'), 7); // 7日後
});
