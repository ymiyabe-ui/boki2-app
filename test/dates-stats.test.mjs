import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addDays, dayTargets, dayType, defaultSlot, diffDays, sumSlots, weekStartOf } from '../js/dates.js';
import { cumulativeSeries, minutesOnDate, planWeekFor, weekSummary } from '../js/stats.js';

const load = async (p) => JSON.parse(await readFile(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const config = await load('config.json');
const plan = await load('plan.json');
const holidays = (await load('holidays.json')).dates;

test('週の始まりは月曜（日曜は前の月曜に戻る）', () => {
  assert.equal(weekStartOf('2026-10-05'), '2026-10-05');
  assert.equal(weekStartOf('2026-10-07'), '2026-10-05');
  assert.equal(weekStartOf('2026-10-11'), '2026-10-05');
  assert.equal(weekStartOf('2026-10-12'), '2026-10-12');
});

test('日付の加減算と差は月またぎ・年またぎでも合う', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(diffDays('2026-10-05', '2026-12-19'), 75);
});

test('土日と祝日は休日、それ以外は平日', () => {
  assert.equal(dayType('2026-10-07', holidays), 'weekday');
  assert.equal(dayType('2026-10-10', holidays), 'holiday'); // 土
  assert.equal(dayType('2026-10-11', holidays), 'holiday'); // 日
  assert.equal(dayType('2026-10-12', holidays), 'holiday'); // 月・スポーツの日
  assert.equal(dayType('2026-11-24', holidays), 'weekday');
});

test('時間帯の初期値：平日は時刻で朝・昼・夜、休日は休日', () => {
  assert.equal(defaultSlot('2026-10-07', 7, holidays), 'morning');
  assert.equal(defaultSlot('2026-10-07', 12, holidays), 'noon');
  assert.equal(defaultSlot('2026-10-07', 21, holidays), 'night');
  assert.equal(defaultSlot('2026-10-10', 7, holidays), 'holiday');
});

test('1日の目標：平日は朝2h・昼1h・夜1h、休日は6h', () => {
  assert.deepEqual(dayTargets('2026-10-07', config, holidays), { morning: 120, noon: 60, night: 60, holiday: 0 });
  assert.deepEqual(dayTargets('2026-10-10', config, holidays), { morning: 0, noon: 0, night: 0, holiday: 360 });
});

test('通常の週の目標は32時間、月曜が祝日の週は34時間', () => {
  const normal = weekSummary([], config, holidays, '2026-10-05');
  assert.equal(normal.totalTarget, 1920);
  assert.equal(normal.target.morning, 600);
  assert.equal(normal.target.holiday, 720);
  const holidayWeek = weekSummary([], config, holidays, '2026-10-12'); // 月曜がスポーツの日
  assert.equal(holidayWeek.totalTarget, 4 * 240 + 3 * 360);
});

test('週の実績は期間内の記録だけを時間帯別に足す', () => {
  const sessions = [
    { date: '2026-10-05', slot: 'morning', minutes: 60 },
    { date: '2026-10-05', slot: 'morning', minutes: 30 },
    { date: '2026-10-10', slot: 'holiday', minutes: 200 },
    { date: '2026-10-04', slot: 'night', minutes: 999 }, // 前の週
    { date: '2026-10-12', slot: 'night', minutes: 999 }, // 次の週
  ];
  const w = weekSummary(sessions, config, holidays, '2026-10-05');
  assert.equal(w.actual.morning, 90);
  assert.equal(w.actual.holiday, 200);
  assert.equal(w.actual.night, 0);
  assert.equal(w.totalActual, 290);
  assert.equal(minutesOnDate(sessions, '2026-10-05').morning, 90);
});

test('累計は計画の最終日に目標の総和と一致し、今日より先の実績は null', () => {
  const sessions = [
    { date: '2026-10-05', slot: 'morning', minutes: 60 },
    { date: '2026-10-06', slot: 'night', minutes: 30 },
  ];
  const s = cumulativeSeries(sessions, config, holidays, '2026-10-05', '2026-12-19', '2026-10-07');
  assert.equal(s.length, 76);
  assert.equal(s[0].plan, 240);
  assert.equal(s[0].actual, 60);
  assert.equal(s[1].actual, 90);
  assert.equal(s[2].actual, 90); // 今日（10/7）は記録なしでも累計は続く
  assert.equal(s[3].actual, null);
  let total = 0;
  for (let d = '2026-10-05'; d <= '2026-12-19'; d = addDays(d, 1)) total += sumSlots(dayTargets(d, config, holidays));
  assert.equal(s.at(-1).plan, total);
});

test('計画の何週目か：開始前・期間内・期間後', () => {
  assert.equal(planWeekFor(plan, '2026-10-04').status, 'before');
  const w1 = planWeekFor(plan, '2026-10-07');
  assert.equal(w1.status, 'in');
  assert.equal(w1.week.week, 1);
  assert.equal(planWeekFor(plan, '2026-12-19').week.week, 11);
  assert.equal(planWeekFor(plan, '2026-12-21').status, 'after');
});
