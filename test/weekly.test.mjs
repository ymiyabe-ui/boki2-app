// 週末の総復習：見込み点・セット・結果の集計・推奨・レポート・模試・保存
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { forecast, mockDiff, mockTotal } from '../js/forecast.js';
import { buildWeeklySet, pastTopicIds, recommend, summarizeWeekly, levelChanges } from '../js/weekly.js';
import { buildWeeklyReport } from '../js/report.js';
import { masteryAll, computeMastery } from '../js/mastery.js';
import { createStore } from '../js/store.js';
import { loadAll } from '../scripts/validate-questions.mjs';

const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const holidays = JSON.parse(await readFile(new URL('../data/holidays.json', import.meta.url), 'utf8')).dates;
const { files, topics, plan } = await loadAll();
const questions = Object.values(files).flatMap((f) => f.questions);
const INT = config.reviewIntervalsDays;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const TODAY = '2026-10-20'; // 第3週（c09〜c13）
const at = (ymd) => () => new Date(`${ymd}T12:00:00`);
const allAt = (level) => Object.fromEntries(topics.map((t) => [t.id, { level }]));

// ---------- 合格見込み点 ----------
test('見込み点：全論点がレベル0なら0点、レベル2なら半分、レベル4なら90点', () => {
  assert.equal(forecast(topics, allAt(0), config).total, 0);
  assert.equal(forecast(topics, allAt(2), config).total, 50);
  assert.ok(Math.abs(forecast(topics, allAt(4), config).total - 90) < 1e-9);
});

test('見込み点：問ごとに「配点×対応論点の期待正答率の平均」で、内訳の合計と一致する', () => {
  const mastery = allAt(0);
  // 第5問に対応する論点（k09〜k11）だけレベル4、k09だけレベル0にする
  for (const t of topics.filter((x) => x.examQ.includes(5))) mastery[t.id] = { level: 4 };
  mastery.k09 = { level: 0 };
  const f = forecast(topics, mastery, config);
  const s5 = f.sections.find((s) => s.q === 5);
  const ids = topics.filter((t) => t.examQ.includes(5)).map((t) => t.id);
  const expected = 12 * ((ids.length - 1) * 0.9 + 0) / ids.length;
  assert.ok(Math.abs(s5.score - expected) < 1e-9, `${s5.score} vs ${expected}`);
  assert.ok(Math.abs(f.total - f.sections.reduce((a, s) => a + s.score, 0)) < 1e-9);
  assert.equal(f.sections.length, 5);
});

test('模試：得点の範囲を検査し、記録時点の予測との差を出す', () => {
  assert.equal(mockTotal({ 1: 18, 2: 12, 3: 14, 4: 20, 5: 8 }, config), 72);
  assert.equal(mockTotal({ 1: 21, 2: 12, 3: 14, 4: 20, 5: 8 }, config), null); // 配点超え
  assert.equal(mockTotal({ 1: 18, 2: NaN, 3: 14, 4: 20, 5: 8 }, config), null); // 未入力
  const m = { total: 72, scores: { 1: 18, 2: 12, 3: 14, 4: 20, 5: 8 }, forecastTotal: 60, forecastBySection: { 1: 10, 2: 10, 3: 10, 4: 20, 5: 10 } };
  const d = mockDiff(m);
  assert.equal(d.total, 12);
  assert.deepEqual(d.bySection, { 1: 8, 2: 2, 3: 4, 4: 0, 5: -2 });
});

// ---------- 総復習セット ----------
const setFor = (data = { attempts: [], reviewQueue: [], topicMarks: {}, weeklyReviews: [], sessions: [] }, today = TODAY) => {
  const mastery = masteryAll(topics, data, config, today);
  const idx = plan.weeks.findIndex((w) => w.start === '2026-10-19');
  const past = pastTopicIds({ plan, planIndex: idx, topics, data });
  return buildWeeklySet({ questions, weekTopicIds: plan.weeks[idx].topics, pastTopicIds: past, mastery, data, config, today });
};

test('総復習は20問で、今週の論点が6割・過去の論点が4割、重複なし', () => {
  const set = setFor();
  assert.equal(set.length, 20);
  assert.equal(new Set(set.map((x) => x.q.id)).size, 20);
  const week = plan.weeks[2].topics;
  const cur = set.filter((x) => x.kind === 'current');
  const past = set.filter((x) => x.kind === 'past');
  assert.equal(cur.length, 12);
  assert.equal(past.length, 8);
  assert.ok(cur.every((x) => week.includes(x.q.topicId)));
  assert.ok(past.every((x) => !week.includes(x.q.topicId)));
});

test('過去の論点は、習熟度の低い論点から出る', () => {
  // c01〜c08 のうち c03 だけレベル0のまま、他は十分に解いてレベル3にしておく
  const attempts = [];
  let n = 0;
  for (const t of topics.slice(0, 8)) {
    if (t.id === 'c03') continue;
    for (const q of questions.filter((x) => x.topicId === t.id).slice(0, 5)) {
      attempts.push({ id: `a${n++}`, ts: '2026-10-15T10:00:00Z', date: '2026-10-15', topicId: t.id, questionId: q.id, score: 1, inTime: true, sec: 30, mode: 'minitest' });
    }
  }
  const data = { attempts, reviewQueue: [], topicMarks: {}, weeklyReviews: [], sessions: [] };
  const set = setFor(data);
  const pastTopics = set.filter((x) => x.kind === 'past').map((x) => x.q.topicId);
  assert.ok(pastTopics.includes('c03'), '最も低い論点が含まれる');
  assert.equal(pastTopics[0], 'c03');
});

test('今週の論点に問題がない週（演習期）でも、過去の論点から20問そろう', () => {
  const data = { attempts: [], reviewQueue: [], topicMarks: {}, weeklyReviews: [], sessions: [] };
  const mastery = masteryAll(topics, data, config, TODAY);
  const set = buildWeeklySet({ questions, weekTopicIds: [], pastTopicIds: topics.map((t) => t.id), mastery, data, config, today: TODAY });
  assert.equal(set.length, 20);
});

// ---------- 推奨・集計 ----------
test('来週の推奨：70%未満はやり直し、90%以上があれば次の論点を前倒し候補に', () => {
  const r = recommend({ topicResults: { c09: { n: 3, rate: 0.5 }, c10: { n: 3, rate: 1 }, c11: { n: 4, rate: 0.75 } }, plan, planIndex: 2, config });
  assert.deepEqual(r.redo, ['c09']);
  assert.deepEqual(r.strong, ['c10']);
  assert.deepEqual(r.advance, ['c14']); // 第4週の最初の論点。90%以上の論点の数（1）だけ
  const none = recommend({ topicResults: { c09: { n: 3, rate: 0.7 } }, plan, planIndex: 2, config });
  assert.deepEqual(none.redo, []); // ちょうど70%はやり直しに入れない
  assert.deepEqual(none.advance, []);
});

test('総復習の集計：論点ごとの正答率・前回との差・やり直しと前倒し', () => {
  const q9 = questions.filter((x) => x.topicId === 'c09');
  const q10 = questions.filter((x) => x.topicId === 'c10');
  const results = [
    ...q9.slice(0, 4).map((q, i) => ({ q, correct: i < 2, sec: 60, kind: 'current' })),
    ...q10.slice(0, 2).map((q) => ({ q, correct: true, sec: 30, kind: 'current' })),
  ];
  const data = { weeklyReviews: [{ weekStart: '2026-10-12', topics: { c09: { rate: 0.8 } } }] };
  const rv = summarizeWeekly({ results, topics, data, config, today: TODAY, planIndex: 2, plan, weekNo: 3 });
  assert.equal(rv.weekStart, '2026-10-19');
  assert.equal(rv.total, 6);
  assert.equal(rv.correct, 4);
  assert.equal(rv.sec, 60 * 4 + 60);
  assert.equal(rv.topics.c09.rate, 0.5);
  assert.equal(rv.topics.c09.prevRate, 0.8);
  assert.equal(rv.topics.c10.prevRate, null);
  assert.deepEqual(rv.recommend.redo, ['c09']);
  assert.deepEqual(rv.recommend.strong, ['c10']);
  assert.equal(rv.wrongIds.length, 2);
});

test('レベルの変化：週の初めと今を比べる', () => {
  const st = createStore(mem(), { now: at('2026-10-14') }).load();
  for (const q of questions.filter((x) => x.topicId === 'c02').slice(0, 5)) st.recordAnswer({ q, correct: true, sec: 30, intervals: INT });
  // 10/19（月）の週の初めには c02 はレベル3、そこから何もしなければ変わらない
  assert.deepEqual(levelChanges(topics, st.data, config, '2026-10-19', TODAY).c02, { before: 3, after: 3 });
  // 10/12 の週の初めにはまだ何もない → レベル0 から3へ
  assert.deepEqual(levelChanges(topics, st.data, config, '2026-10-12', '2026-10-14').c02, { before: 0, after: 3 });
});

test('総復習の結果を2週続けて80%以上にすると、レベル3の論点がレベル4になる', () => {
  const st = createStore(mem(), { now: at('2026-10-14') }).load();
  for (const q of questions.filter((x) => x.topicId === 'c02').slice(0, 5)) st.recordAnswer({ q, correct: true, sec: 30, intervals: INT });
  assert.equal(computeMastery('c02', st.data, config, '2026-10-20').level, 3);
  st.addWeeklyReview({ weekStart: '2026-10-12', topics: { c02: { rate: 0.9 } } });
  assert.equal(computeMastery('c02', st.data, config, '2026-10-20').level, 3);
  st.addWeeklyReview({ weekStart: '2026-10-19', topics: { c02: { rate: 0.85 } } });
  assert.equal(computeMastery('c02', st.data, config, '2026-10-20').level, 4);
});

test('同じ週の総復習は最新の1件に置き換わる', () => {
  const st = createStore(mem(), { now: at(TODAY) }).load();
  st.addWeeklyReview({ weekStart: '2026-10-19', total: 20, correct: 10, topics: {} });
  st.addWeeklyReview({ weekStart: '2026-10-19', total: 20, correct: 15, topics: {} });
  assert.equal(st.data.weeklyReviews.length, 1);
  assert.equal(st.data.weeklyReviews[0].correct, 15);
});

test('模試を保存・読み込み・削除できる。予測は記録時点の値が残る', () => {
  const storage = mem();
  const st = createStore(storage, { now: at(TODAY) }).load();
  const f = forecast(topics, allAt(2), config);
  const m = st.addMock({ date: TODAY, scores: { 1: 10, 2: 10, 3: 10, 4: 20, 5: 6 }, total: 56, minutes: 90, forecast: f });
  assert.equal(m.forecastTotal, 50);
  const again = createStore(storage).load();
  assert.equal(again.data.mocks.length, 1);
  assert.equal(again.data.mocks[0].forecastBySection[1], 10);
  again.deleteMock(m.id);
  assert.equal(createStore(storage).load().data.mocks.length, 0);
});

// ---------- 週次レポート ----------
test('週次レポート：期間・時間帯別の時間・論点ごとの正答率とレベル・間違えた問題・誤り報告・模試・推奨が入る', () => {
  const st = createStore(mem(), { now: at('2026-10-20') }).load();
  st.addSession({ date: '2026-10-19', slot: 'morning', minutes: 120, topicId: 'c09', kind: 'input' });
  st.addSession({ date: '2026-10-18', slot: 'holiday', minutes: 300, topicId: 'c08', kind: 'input' }); // 先週：入らない
  const q9 = questions.filter((x) => x.topicId === 'c09');
  q9.slice(0, 5).forEach((q, i) => st.recordAnswer({ q, correct: i !== 0, sec: 30, intervals: INT }));
  st.addErrorReport({ q: q9[0], note: '解説の金額が合わない' });
  st.addMock({ date: '2026-10-20', scores: { 1: 10, 2: 10, 3: 10, 4: 20, 5: 6 }, total: 56, forecast: forecast(topics, allAt(1), config) });
  const results = q9.slice(0, 5).map((q, i) => ({ q, correct: i !== 0, sec: 30, kind: 'current' }));
  st.addWeeklyReview(summarizeWeekly({ results, topics, data: st.data, config, today: '2026-10-20', planIndex: 2, plan, weekNo: 3 }));

  const rep = buildWeeklyReport({ data: st.data, topics, config, plan, holidays, today: '2026-10-20', appVersion: '0.3.0', now: new Date('2026-10-20T12:00:00') });
  assert.deepEqual([rep.period.start, rep.period.end, rep.period.planWeek], ['2026-10-19', '2026-10-25', 3]);
  assert.equal(rep.study.totalMinutes, 120);
  assert.equal(rep.study.bySlot.morning.actual, 120);
  assert.equal(rep.study.bySlot.morning.target, 600);
  const c09 = rep.topics.find((t) => t.topicId === 'c09');
  assert.equal(c09.attempts, 5);
  assert.equal(c09.rate, 80);
  assert.equal(c09.levelBefore, 0);
  assert.ok(c09.levelAfter >= 1);
  assert.deepEqual(rep.wrongQuestions.map((w) => w.questionId), [q9[0].id]);
  assert.equal(rep.wrongQuestions[0].rev, 1);
  assert.equal(rep.errorReports[0].note, '解説の金額が合わない');
  assert.equal(rep.mocks[0].total, 56);
  assert.equal(rep.mocks[0].diff.total, 56 - rep.mocks[0].forecastTotal);
  assert.equal(rep.weeklyReview.correct, 4);
  assert.deepEqual(rep.recommendation.redo, []);
  assert.equal(rep.forecast.passScore, 70);
  assert.equal(rep.forecast.sections.length, 5);
  assert.ok(rep.forecast.now >= rep.forecast.atWeekStart);
  // JSON にして貼り付けても壊れない
  assert.deepEqual(JSON.parse(JSON.stringify(rep)), rep);
});

test('記録が何もない週でも週次レポートを作れる', () => {
  const st = createStore(mem(), { now: at(TODAY) }).load();
  const rep = buildWeeklyReport({ data: st.data, topics, config, plan, holidays, today: TODAY, now: new Date() });
  assert.equal(rep.study.totalMinutes, 0);
  assert.equal(rep.weeklyReview, null);
  assert.equal(rep.recommendation, null);
  assert.deepEqual(rep.wrongQuestions, []);
});
