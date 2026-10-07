// 勉強時間の集計（純粋関数。画面とテストの両方から使う）
import { SLOTS, addDays, dayTargets, sumSlots, weekStartOf } from './dates.js';

const zeroSlots = () => ({ morning: 0, noon: 0, night: 0, holiday: 0 });

export function minutesOnDate(sessions, ymd) {
  const out = zeroSlots();
  for (const s of sessions) if (s.date === ymd) out[s.slot] = (out[s.slot] || 0) + s.minutes;
  return out;
}

/** 週（月曜始まり）の実績と目標を時間帯別に返す。目標は祝日を休日扱いにして日ごとに積み上げる */
export function weekSummary(sessions, config, holidayMap, weekStart) {
  const actual = zeroSlots();
  const target = zeroSlots();
  const end = addDays(weekStart, 6);
  for (let i = 0; i < 7; i++) {
    const t = dayTargets(addDays(weekStart, i), config, holidayMap);
    for (const s of SLOTS) target[s] += t[s];
  }
  for (const s of sessions) {
    if (s.date >= weekStart && s.date <= end) actual[s.slot] = (actual[s.slot] || 0) + s.minutes;
  }
  return { weekStart, actual, target, totalActual: sumSlots(actual), totalTarget: sumSlots(target) };
}

/** 開始日〜終了日の累計。plan は目標の累計、actual は今日までの実績の累計（今日より先は null） */
export function cumulativeSeries(sessions, config, holidayMap, startYmd, endYmd, todayYmd) {
  const byDate = {};
  let actual = 0;
  for (const s of sessions) {
    if (s.date < startYmd) actual += s.minutes;
    else byDate[s.date] = (byDate[s.date] || 0) + s.minutes;
  }
  const out = [];
  let plan = 0;
  for (let d = startYmd; d <= endYmd; d = addDays(d, 1)) {
    plan += sumSlots(dayTargets(d, config, holidayMap));
    actual += byDate[d] || 0;
    out.push({ date: d, plan, actual: d <= todayYmd ? actual : null });
  }
  return out;
}

/** 今日が学習計画の何週目か。status は 'before'（開始前）/ 'in'（計画期間内）/ 'after'（期間後） */
export function planWeekFor(plan, todayYmd) {
  const weeks = plan.weeks;
  if (todayYmd < weeks[0].start) return { status: 'before', week: null, index: -1 };
  for (let i = 0; i < weeks.length; i++) {
    if (weekStartOf(todayYmd) === weeks[i].start) return { status: 'in', week: weeks[i], index: i };
  }
  return { status: 'after', week: null, index: weeks.length };
}
