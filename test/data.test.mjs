// 静的データ（論点・設定・学習計画）の整合性テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async (p) => JSON.parse(await readFile(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const topics = (await load('topics.json')).topics;
const config = await load('config.json');
const plan = await load('plan.json');
const ids = new Set(topics.map((t) => t.id));

test('論点IDが重複していない', () => {
  assert.equal(ids.size, topics.length);
});

test('論点の主な出題は第1〜5問のどれか', () => {
  for (const t of topics) {
    assert.ok(t.examQ.length > 0, t.id);
    for (const q of t.examQ) assert.ok(q >= 1 && q <= 5, `${t.id}: ${q}`);
  }
});

test('配点の合計が100点で、各問に対応する論点がある', () => {
  const sum = config.examSections.reduce((a, s) => a + s.points, 0);
  assert.equal(sum, 100);
  for (const s of config.examSections) {
    assert.ok(topics.some((t) => t.examQ.includes(s.q)), `第${s.q}問に論点がない`);
  }
});

test('期待正答率はレベル0〜4の5つで、単調に増える', () => {
  const r = config.expectedRateByLevel;
  assert.equal(r.length, 5);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] > r[i - 1]);
});

test('学習計画は全論点を1回ずつ、論点マップの順に割り当てている', () => {
  const assigned = plan.weeks.flatMap((w) => w.topics);
  assert.deepEqual(assigned, [...topics].sort((a, b) => a.order - b.order).map((t) => t.id));
});

test('学習計画の週は月曜始まりで7日おきに並び、受験日を含む', () => {
  plan.weeks.forEach((w, i) => {
    const d = new Date(`${w.start}T00:00:00Z`);
    assert.equal(d.getUTCDay(), 1, `${w.start} は月曜でない`);
    if (i > 0) {
      const prev = new Date(`${plan.weeks[i - 1].start}T00:00:00Z`);
      assert.equal((d - prev) / 86400000, 7);
    }
  });
  const last = new Date(`${plan.weeks.at(-1).start}T00:00:00Z`);
  const exam = new Date(`${config.examDate}T00:00:00Z`);
  assert.ok(exam >= last && (exam - last) / 86400000 < 7);
  assert.equal(plan.examDate, config.examDate);
});

test('週の目標時間が時間帯の合計と一致する', () => {
  const t = config.targetMinutes;
  const weekday = Object.values(t.weekday).reduce((a, b) => a + b, 0);
  assert.equal(weekday * 5 + t.holiday.total * 2, t.weekly);
});
