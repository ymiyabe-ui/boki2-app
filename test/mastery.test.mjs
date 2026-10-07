import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeMastery, masteryAll, refKey, retryList, scoreMark } from '../js/mastery.js';

const load = async (p) => JSON.parse(await readFile(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const config = await load('config.json');
const topics = (await load('topics.json')).topics;

const TODAY = '2026-10-20';
let seq = 0;
// 問題集ログの解答を作る。date を指定した順に ts も進める
const att = (topicId, score, { inTime = true, date = '2026-10-19', no = String(++seq), book = '本A', page = '10' } = {}) => ({
  id: `a${seq}`, ts: `${date}T10:00:${String(seq % 60).padStart(2, '0')}.000Z`, date, topicId, mode: 'workbook',
  ref: { book, page, no }, questionId: null, score, inTime, sec: null,
});
const data = (attempts = [], extra = {}) => ({ attempts, sessions: [], topicMarks: {}, weeklyReviews: [], ...extra });
const level = (d, id = 'c05') => computeMastery(id, d, config, TODAY).level;

test('記録がなければレベル0', () => {
  assert.equal(level(data()), 0);
});

test('「テキストを読んだ」だけでレベル1', () => {
  assert.equal(level(data([], { topicMarks: { c05: { readAt: '2026-10-19T00:00:00Z', readDate: '2026-10-19' } } })), 1);
});

test('解答が少ないうちは正答率が高くてもレベル1にとどまる', () => {
  assert.equal(level(data([att('c05', 1), att('c05', 1)])), 1);
});

test('直近が3問以上で正答率50%以上ならレベル2、50%未満ならレベル1', () => {
  assert.equal(level(data([att('c05', 1), att('c05', 1), att('c05', 0)], {})), 2);
  assert.equal(level(data([att('c05', 1), att('c05', 0), att('c05', 0)])), 1);
});

test('△は0.5として数える（○△×の3問で正答率50%）', () => {
  const m = computeMastery('c05', data([att('c05', 1), att('c05', 0.5), att('c05', 0)]), config, TODAY);
  assert.equal(m.rate, 0.5);
  assert.equal(m.level, 2);
});

test('レベル3：5問以上で正答率80%以上、かつその8割以上が目安時間内', () => {
  const ok = data([1, 1, 1, 1, 1].map((s) => att('c05', s)));
  assert.equal(level(ok), 3);
  // 時間内が6割しかなければレベル2のまま
  const slow = data([att('c05', 1), att('c05', 1), att('c05', 1, { inTime: false }), att('c05', 1, { inTime: false }), att('c05', 1)]);
  assert.equal(level(slow), 2);
  // 正答率80%ちょうど（5問中4問）は含む、60%ならレベル2のまま
  const edge = data([att('c05', 1), att('c05', 1), att('c05', 1), att('c05', 0), att('c05', 1)]);
  assert.equal(computeMastery('c05', edge, config, TODAY).rate, 0.8);
  assert.equal(level(edge), 3);
  const lower = data([att('c05', 1), att('c05', 1), att('c05', 0), att('c05', 0), att('c05', 1)]);
  assert.equal(level(lower), 2);
  // 時間内の割合が80%ちょうど（5問中4問）は含む
  const inTimeEdge = data([att('c05', 1), att('c05', 1), att('c05', 1), att('c05', 1), att('c05', 1, { inTime: false })]);
  assert.equal(level(inTimeEdge), 3);
});

test('正答率は直近10問で見る（古い誤答は効かない）', () => {
  const old = Array.from({ length: 5 }, (_, i) => att('c05', 0, { date: `2026-10-0${i + 1}` }));
  const recent = Array.from({ length: 10 }, () => att('c05', 1, { date: '2026-10-19' }));
  const m = computeMastery('c05', data([...old, ...recent]), config, TODAY);
  assert.equal(m.n, 10);
  assert.equal(m.rate, 1);
  assert.equal(m.level, 3);
});

test('レベル4：レベル3に加えて、7日以上あけた再挑戦で○なら昇格', () => {
  const first = att('c05', 0, { date: '2026-10-05', no: '7' });
  const again = att('c05', 1, { date: '2026-10-13', no: '7' }); // 8日後に同じ問題で○
  const fill = Array.from({ length: 4 }, () => att('c05', 1));
  assert.equal(level(data([first, again, ...fill])), 4);
  // 6日後では足りない
  const early = att('c05', 1, { date: '2026-10-11', no: '7' });
  assert.equal(level(data([first, early, ...fill])), 3);
});

test('レベル4：週末総復習で2週続けて80%以上でも昇格（連続しない週は不可）', () => {
  const fill = Array.from({ length: 5 }, () => att('c05', 1));
  const wk = (weekStart, rate) => ({ weekStart, topics: { c05: { rate } } });
  assert.equal(level(data(fill, { weeklyReviews: [wk('2026-10-05', 0.85), wk('2026-10-12', 0.9)] })), 4);
  assert.equal(level(data(fill, { weeklyReviews: [wk('2026-10-05', 0.85), wk('2026-10-19', 0.9)] })), 3);
  assert.equal(level(data(fill, { weeklyReviews: [wk('2026-10-05', 0.85), wk('2026-10-12', 0.7)] })), 3);
});

test('14日以上触れていない論点は「要復習」。レベルは下げない', () => {
  const old = Array.from({ length: 5 }, () => att('c05', 1, { date: '2026-10-05' }));
  const m = computeMastery('c05', data(old), config, TODAY); // 15日前
  assert.equal(m.level, 3);
  assert.equal(m.stale, true);
  const fresh = computeMastery('c05', data(old.map((a) => ({ ...a, date: '2026-10-07' }))), config, TODAY); // 13日前
  assert.equal(fresh.stale, false);
  // 記録のない論点は要復習にならない
  assert.equal(computeMastery('c06', data(), config, TODAY).stale, false);
});

test('勉強時間の記録はレベルを変えないが、最後に触れた日には効く', () => {
  const d = data([], { sessions: [{ topicId: 'c05', date: '2026-10-19', minutes: 60 }] });
  const m = computeMastery('c05', d, config, TODAY);
  assert.equal(m.level, 0);
  assert.equal(m.lastTouched, '2026-10-19');
});

test('論点ごとに独立して判定する', () => {
  const all = masteryAll(topics, data([att('c05', 1), att('c05', 1), att('c05', 1), att('c06', 0)]), config, TODAY);
  assert.equal(all.c05.level, 2);
  assert.equal(all.c06.level, 1);
  assert.equal(all.c07.level, 0);
  assert.equal(Object.keys(all).length, topics.length);
});

test('再挑戦リスト：最新の結果が○でない問題だけが残る', () => {
  const x = att('c05', 0, { date: '2026-10-10', no: '1' });
  const xThenO = att('c05', 1, { date: '2026-10-12', no: '1' }); // 同じ問題をその後○にした → 外れる
  const tri = att('c05', 0.5, { date: '2026-10-11', no: '2' });
  const oThenX = [att('c06', 1, { date: '2026-10-08', no: '3' }), att('c06', 0, { date: '2026-10-15', no: '3' })]; // ○の後に×
  const list = retryList([x, xThenO, tri, ...oThenX]);
  assert.deepEqual(list.map((r) => r.ref.no).sort(), ['2', '3']);
  assert.equal(list.find((r) => r.ref.no === '3').tries, 2);
});

test('同じ問題の判定は全角・半角や大文字小文字の違いを吸収する', () => {
  const a = { ref: { book: ' 本A ', page: '１０', no: '３-ａ' } };
  const b = { ref: { book: '本A', page: '10', no: '3-A' } };
  assert.equal(refKey(a), refKey(b));
});

test('得点の記号', () => {
  assert.deepEqual([1, 0.5, 0].map(scoreMark), ['○', '△', '×']);
});

test('同じ時刻の記録は、後から追加した方を新しいとみなす（×のあとに同時刻で○なら再挑戦リストから外れる）', () => {
  const ts = '2026-10-10T10:00:00.000Z';
  const x = { ...att('c05', 0, { no: '9' }), ts };
  const o = { ...att('c05', 1, { no: '9' }), ts };
  assert.equal(retryList([x, o]).length, 0);
  assert.equal(retryList([o, x]).length, 1);
});
