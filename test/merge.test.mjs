// 端末間の同期：記録のまとめ方（足し合わせ・削除の伝わり方・再出題の作り直し）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { applyAnswer } from '../js/review.js';
import { mergeData, fingerprint, sameContent, forServer, isEmptyData, rebuildQueue } from '../js/merge.js';

const INTERVALS = [1, 3, 7];
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const clock = (start) => { let t = Date.parse(start); return () => new Date((t += 1000)); };
const device = (start) => createStore(mem(), { now: clock(start) }).load();
const q = (id, topicId = 'c01') => ({ id, topicId, rev: 1, targetSec: 60 });

test('記録は足し合わせになり、どちらの順でまとめても、同じ中身になる', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-26T09:30:00Z');
  a.addSession({ date: '2026-11-26', slot: 'morning', minutes: 60, topicId: 'c01' });
  b.addSession({ date: '2026-11-26', slot: 'noon', minutes: 30, topicId: 'c02' });
  a.addAttempt({ topicId: 'c01', score: 1 });
  b.addAttempt({ topicId: 'c02', score: 0.5 });
  const ab = mergeData(a.data, b.data);
  const ba = mergeData(b.data, a.data);
  assert.equal(ab.sessions.length, 2);
  assert.equal(ab.attempts.length, 2);
  assert.ok(sameContent(ab, ba));
  assert.deepEqual(ab.sessions.map((s) => s.id), ba.sessions.map((s) => s.id)); // 並びも同じ（時刻順）
});

test('同じ記録を何度まとめても増えない（繰り返しても同じ）', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-26T09:30:00Z');
  a.addSession({ date: '2026-11-26', slot: 'morning', minutes: 60 });
  b.addSession({ date: '2026-11-26', slot: 'noon', minutes: 30 });
  const once = mergeData(a.data, b.data);
  const twice = mergeData(once, b.data);
  const thrice = mergeData(twice, a.data);
  assert.equal(fingerprint(once), fingerprint(thrice));
  assert.equal(thrice.sessions.length, 2);
});

test('元のデータは書き換えない', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-26T09:30:00Z');
  a.addSession({ date: '2026-11-26', slot: 'morning', minutes: 60 });
  b.addSession({ date: '2026-11-26', slot: 'noon', minutes: 30 });
  const before = JSON.stringify([a.data, b.data]);
  mergeData(a.data, b.data, { intervals: INTERVALS });
  assert.equal(JSON.stringify([a.data, b.data]), before);
});

test('片方で消した記録は、もう片方に残っていても消え、後から来ても復活しない', () => {
  const a = device('2026-11-26T09:00:00Z');
  const s = a.addSession({ date: '2026-11-26', slot: 'morning', minutes: 60 });
  const b = device('2026-11-26T09:30:00Z');
  b.replaceAll(JSON.parse(JSON.stringify(a.data))); // 同期済みのコピー
  a.deleteSession(s.id);
  const merged = mergeData(b.data, a.data);
  assert.equal(merged.sessions.length, 0);
  assert.equal(mergeData(merged, b.data).sessions.length, 0); // 古いコピーとまとめても戻らない
  assert.ok(merged.meta.deleted[s.id]);
});

test('模試・誤り報告・問題集ログの削除も伝わる', () => {
  const a = device('2026-11-26T09:00:00Z');
  const m = a.addMock({ date: '2026-11-26', scores: { 1: 10 }, total: 10 });
  const t = a.addAttempt({ topicId: 'c01', score: 1 });
  const r = a.addErrorReport({ q: q('c01-001'), note: 'x' });
  const b = device('2026-11-26T09:30:00Z');
  b.replaceAll(JSON.parse(JSON.stringify(a.data)));
  a.deleteMock(m.id); a.deleteAttempt(t.id); a.deleteErrorReport(r.id);
  const merged = mergeData(b.data, a.data);
  assert.deepEqual([merged.mocks.length, merged.attempts.length, merged.errorReports.length], [0, 0, 0]);
});

test('読了チェック：新しいほうが残り、外した操作も伝わり、あとで付け直せば戻る', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-26T10:00:00Z');
  a.setTopicRead('c01', true);
  b.setTopicRead('c02', true);
  const m1 = mergeData(a.data, b.data);
  assert.deepEqual(Object.keys(m1.topicMarks).sort(), ['c01', 'c02']);
  // a が c01 を外す（b は c01 を持たず、古いコピーを持つ想定で、a の外した記録とまとめる）
  const old = JSON.parse(JSON.stringify(a.data));
  a.setTopicRead('c01', false);
  assert.equal(mergeData(old, a.data).topicMarks.c01, undefined);
  // 外したあとに付け直すと、新しい日時のほうが勝つ
  a.setTopicRead('c01', true);
  assert.ok(mergeData(old, a.data).topicMarks.c01);
});

test('同じ週の総復習は、新しいほうの1件だけ残る', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-26T12:00:00Z');
  a.addWeeklyReview({ weekStart: '2026-11-23', rate: 0.5 });
  const nb = b.addWeeklyReview({ weekStart: '2026-11-23', rate: 0.9 });
  const m = mergeData(a.data, b.data);
  assert.equal(m.weeklyReviews.length, 1);
  assert.equal(m.weeklyReviews[0].id, nb.id);
});

test('再出題の予定は、解答の履歴から作り直した結果が、順に解いたときと一致する', () => {
  const a = device('2026-11-26T09:00:00Z');
  const b = device('2026-11-27T09:00:00Z');
  a.recordAnswer({ q: q('c01-001'), correct: false, sec: 30, intervals: INTERVALS });
  b.recordAnswer({ q: q('c01-002'), correct: false, sec: 30, intervals: INTERVALS });
  const merged = mergeData(a.data, b.data, { intervals: INTERVALS });
  let expected = [];
  for (const x of merged.attempts) expected = applyAnswer(expected, { questionId: x.questionId, topicId: x.topicId, correct: x.score === 1, date: x.date }, INTERVALS);
  assert.deepEqual(merged.reviewQueue, expected);
  assert.deepEqual(merged.reviewQueue.map((x) => x.questionId).sort(), ['c01-001', 'c01-002']);
  assert.deepEqual(rebuildQueue(merged.attempts, INTERVALS), expected);
});

test('解答が増えなければ、この端末の再出題の予定はそのまま', () => {
  const a = device('2026-11-26T09:00:00Z');
  a.recordAnswer({ q: q('c01-001'), correct: false, sec: 30, intervals: INTERVALS });
  const queue = JSON.parse(JSON.stringify(a.data.reviewQueue));
  const merged = mergeData(a.data, JSON.parse(JSON.stringify(a.data)), { intervals: INTERVALS });
  assert.deepEqual(merged.reviewQueue, queue);
});

test('タイマーとバックアップ日時はこの端末のものを保ち、サーバーには送らない', () => {
  const a = device('2026-11-26T09:00:00Z');
  a.startTimer({ slot: 'morning', topicId: 'c01' });
  a.markBackedUp();
  const b = device('2026-11-26T09:30:00Z');
  b.markBackedUp();
  const m = mergeData(a.data, b.data);
  assert.ok(m.timer);
  assert.equal(m.meta.lastBackupAt, a.data.meta.lastBackupAt);
  const sent = forServer(m);
  assert.equal(sent.timer, undefined);
  assert.equal(sent.meta.lastBackupAt, undefined);
  assert.ok(isEmptyData(forServer(device('2026-11-26T09:00:00Z').data)));
});
