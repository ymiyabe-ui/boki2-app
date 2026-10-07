// ミニテスト：採点・再出題・毎日のセット・習熟度への反映・保存
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gradeAnswer, parseAmount } from '../js/grade.js';
import { applyAnswer, dueItems } from '../js/review.js';
import { buildSet } from '../js/dailyset.js';
import { computeMastery, masteryAll } from '../js/mastery.js';
import { createStore, STORAGE_KEY } from '../js/store.js';
import { loadAll } from '../scripts/validate-questions.mjs';

const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const { files, topics, plan } = await loadAll();
const questions = Object.values(files).flatMap((f) => f.questions);
const INT = config.reviewIntervalsDays; // [1, 3, 7]
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };

const jq = {
  id: 'x-001', type: 'journal', topicId: 'c05', targetSec: 180,
  answer: { debit: [{ account: '未収入金', amount: 400000 }, { account: '減価償却費', amount: 240000 }], credit: [{ account: '備品', amount: 640000 }] },
};
const entries = (debit, credit) => ({ debit, credit });
const row = (account, amount) => ({ account, amount });

// ---------- 採点 ----------
test('金額の入力は全角・カンマ・「円」を受け付け、読めなければ NaN', () => {
  assert.equal(parseAmount('１，２００，０００'), 1200000);
  assert.equal(parseAmount(' 3,000円 '), 3000);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('仕訳：行の順番が違っても正解になる', () => {
  const g = gradeAnswer(jq, entries([row('減価償却費', '240000'), row('未収入金', '400000')], [row('備品', '640000')]));
  assert.equal(g.correct, true);
});

test('仕訳：同じ科目を分けて入力しても、借方・貸方ごとに合算して採点する', () => {
  const g = gradeAnswer(jq, entries([row('未収入金', '400000'), row('減価償却費', '100000'), row('減価償却費', '140000')], [row('備品', '640000')]));
  assert.equal(g.correct, true);
});

test('仕訳：金額違い・科目違い・借方貸方の逆・余分な行は不正解', () => {
  assert.equal(gradeAnswer(jq, entries([row('未収入金', '400000'), row('減価償却費', '230000')], [row('備品', '640000')])).correct, false);
  assert.equal(gradeAnswer(jq, entries([row('売掛金', '400000'), row('減価償却費', '240000')], [row('備品', '640000')])).correct, false);
  assert.equal(gradeAnswer(jq, entries([row('備品', '640000')], [row('未収入金', '400000'), row('減価償却費', '240000')])).correct, false);
  assert.equal(gradeAnswer(jq, entries([row('未収入金', '400000'), row('減価償却費', '240000'), row('現金', '1')], [row('備品', '640000')])).correct, false);
});

test('仕訳：科目だけ・金額だけの行があれば不正解、空行は無視', () => {
  assert.equal(gradeAnswer(jq, entries([row('未収入金', '400000'), row('減価償却費', '')], [row('備品', '640000')])).correct, false);
  assert.equal(gradeAnswer(jq, entries([row('未収入金', '400000'), row('減価償却費', '240000'), row('', '')], [row('備品', '640000'), row('', '')])).correct, true);
});

test('数値入力・選択式の採点', () => {
  const nq = { type: 'numeric', answer: { value: 1750000, unit: '円' } };
  assert.equal(gradeAnswer(nq, '1,750,000').correct, true);
  assert.equal(gradeAnswer(nq, '１７５０００００').correct, false);
  assert.equal(gradeAnswer(nq, '').correct, false);
  const cq = { type: 'choice', answer: { index: 2 } };
  assert.equal(gradeAnswer(cq, 2).correct, true);
  assert.equal(gradeAnswer(cq, 1).correct, false);
  assert.equal(gradeAnswer(cq, null).correct, false);
});

test('収録した全問題について、答えの通りに入力すると正解になる', () => {
  for (const q of questions) {
    let resp;
    if (q.type === 'journal') resp = { debit: q.answer.debit.map((x) => ({ ...x })), credit: q.answer.credit.map((x) => ({ ...x })) };
    else if (q.type === 'numeric') resp = String(q.answer.value);
    else resp = q.answer.index;
    assert.equal(gradeAnswer(q, resp).correct, true, q.id);
  }
});

// ---------- 再出題 ----------
test('間違えると1日後に再出題され、1日後→3日後→7日後と正解を重ねると卒業する', () => {
  let q = applyAnswer([], { questionId: 'a', topicId: 'c05', correct: false, date: '2026-10-10' }, INT);
  assert.deepEqual(q, [{ questionId: 'a', topicId: 'c05', stage: 0, due: '2026-10-11', wrongDate: '2026-10-10' }]);
  assert.equal(dueItems(q, '2026-10-10').length, 0);
  assert.equal(dueItems(q, '2026-10-11').length, 1);
  q = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-11' }, INT);
  assert.equal(q[0].stage, 1);
  assert.equal(q[0].due, '2026-10-14'); // 3日後
  q = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-14' }, INT);
  assert.equal(q[0].stage, 2);
  assert.equal(q[0].due, '2026-10-21'); // 7日後
  q = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-21' }, INT);
  assert.deepEqual(q, []); // 卒業
});

test('途中で間違えたら1日後からやり直す', () => {
  let q = applyAnswer([], { questionId: 'a', topicId: 'c05', correct: false, date: '2026-10-10' }, INT);
  q = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-11' }, INT);
  q = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: false, date: '2026-10-14' }, INT);
  assert.equal(q.length, 1);
  assert.equal(q[0].stage, 0);
  assert.equal(q[0].due, '2026-10-15');
});

test('初見で正解した問題は予定に入らず、予定日より前に正解しても進まない', () => {
  assert.deepEqual(applyAnswer([], { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-10' }, INT), []);
  const q = applyAnswer([], { questionId: 'a', topicId: 'c05', correct: false, date: '2026-10-10' }, INT);
  const q2 = applyAnswer(q, { questionId: 'a', topicId: 'c05', correct: true, date: '2026-10-10' }, INT);
  assert.deepEqual(q2, q);
});

test('間違えた問題が翌日の毎日のセットに再出題として入る（保存を通して確認）', () => {
  const st = createStore(memStorage(), { now: () => new Date('2026-10-10T12:00:00') }).load();
  const target = questions.find((x) => x.topicId === 'c01');
  st.recordAnswer({ q: target, correct: false, sec: 100, intervals: INT });
  const set = buildSet({ questions, weekTopicIds: ['c01', 'c02', 'c03', 'c04'], mastery: masteryAll(topics, st.data, config, '2026-10-11'), data: st.data, config, today: '2026-10-11' });
  const first = set[0];
  assert.equal(first.kind, 'review');
  assert.equal(first.q.id, target.id);
});

// ---------- 毎日のセット ----------
const base = (over = {}) => ({
  questions, weekTopicIds: ['c01', 'c02', 'c03', 'c04'], mastery: {}, data: { attempts: [], reviewQueue: [] }, config, today: '2026-10-06', ...over,
});

test('毎日のセットは今週の論点から5問＋補い3問で、重複しない', () => {
  const set = buildSet(base());
  assert.equal(set.length, 8);
  assert.equal(new Set(set.map((x) => x.q.id)).size, 8);
  assert.equal(set.filter((x) => x.kind === 'planned').length, 5);
  assert.ok(set.filter((x) => x.kind === 'planned').every((x) => ['c01', 'c02', 'c03', 'c04'].includes(x.q.topicId)));
});

test('再出題がなければ、すでに触れた論点のうち習熟度の低い論点から補う', () => {
  const mastery = { c01: { level: 3 }, c02: { level: 1 }, c05: { level: 2 } };
  const set = buildSet(base({ mastery, weekTopicIds: ['c01'] }));
  const fill = set.filter((x) => x.kind === 'review');
  assert.equal(fill.length, 3);
  assert.ok(fill.every((x) => x.q.topicId === 'c02'));
});

test('再出題の予定があれば、補いより先に出る（最大3問）', () => {
  const ids = questions.filter((x) => x.topicId === 'c09').slice(0, 4).map((x) => x.id);
  const reviewQueue = ids.map((id, i) => ({ questionId: id, topicId: 'c09', stage: 0, due: `2026-10-0${i + 1}` }));
  const set = buildSet(base({ data: { attempts: [], reviewQueue } }));
  assert.deepEqual(set.slice(0, 3).map((x) => x.q.id), ids.slice(0, 3));
  assert.ok(set.slice(0, 3).every((x) => x.kind === 'review'));
});

test('「もう1セット」は、すでに出した問題を含まない', () => {
  const first = buildSet(base());
  const second = buildSet(base({ exclude: new Set(first.map((x) => x.q.id)), setNo: 1 }));
  assert.equal(second.length, 8);
  const ids = new Set(first.map((x) => x.q.id));
  assert.ok(second.every((x) => !ids.has(x.q.id)));
});

test('今週の論点に問題がない週（演習期など）は、習熟度の低い論点から出す', () => {
  const set = buildSet(base({ weekTopicIds: [] }));
  assert.equal(set.length, 8);
});

test('未解答の問題を優先し、同じ日の並びは変わらない', () => {
  const done = questions.filter((x) => x.topicId === 'c01').slice(0, 4);
  const attempts = done.map((q, i) => ({ id: `a${i}`, ts: '2026-10-05T10:00:00Z', questionId: q.id, score: 1 }));
  const set = buildSet(base({ data: { attempts, reviewQueue: [] }, weekTopicIds: ['c01', 'c02', 'c03'] }));
  const planned = set.map((x) => x.q.id);
  assert.ok(planned.every((id) => !done.some((d) => d.id === id)));
  assert.deepEqual(buildSet(base()).map((x) => x.q.id), buildSet(base()).map((x) => x.q.id));
});

// ---------- 習熟度・保存 ----------
test('ミニテストの結果が習熟度に反映される（正答・目安時間内で上がる）', () => {
  const st = createStore(memStorage(), { now: () => new Date('2026-10-20T12:00:00') }).load();
  const qs = questions.filter((x) => x.topicId === 'c02').slice(0, 5);
  for (const q of qs) st.recordAnswer({ q, correct: true, sec: 30, intervals: INT });
  const m = computeMastery('c02', st.data, config, '2026-10-20');
  assert.equal(m.n, 5);
  assert.equal(m.level, 3);
  // 時間超過だとレベル3にならない
  const st2 = createStore(memStorage(), { now: () => new Date('2026-10-20T12:00:00') }).load();
  for (const q of qs) st2.recordAnswer({ q, correct: true, sec: q.targetSec + 100, intervals: INT });
  assert.equal(computeMastery('c02', st2.data, config, '2026-10-20').level, 2);
});

test('解答と誤り報告は保存され、読み込み直しても残る', () => {
  const storage = memStorage();
  const st = createStore(storage, { now: () => new Date('2026-10-10T12:00:00') }).load();
  const q = questions[0];
  st.recordAnswer({ q, correct: false, sec: 45, intervals: INT });
  st.addErrorReport({ q, note: '解説の金額が合わない' });
  const again = createStore(storage).load();
  assert.equal(again.data.attempts.length, 1);
  assert.equal(again.data.attempts[0].questionId, q.id);
  assert.equal(again.data.attempts[0].qrev, q.rev);
  assert.equal(again.data.reviewQueue.length, 1);
  assert.equal(again.data.errorReports[0].note, '解説の金額が合わない');
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('計画の最初の3週分の論点にすべて問題があり、全問が未確認で始まっている', () => {
  const need = plan.weeks.slice(0, 3).flatMap((w) => w.topics);
  for (const id of need) assert.ok(questions.filter((q) => q.topicId === id).length >= 8, id);
  assert.ok(questions.every((q) => q.source === 'original'));
});
