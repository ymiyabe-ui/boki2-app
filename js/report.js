// 週次レポート（純粋関数）。スマホから書き出して、PCのClaude Codeに貼り付けて週次アップデートに使う。
// 個人の記録なので、リポジトリには入れず private/reviews/ に保存する。
import { addDays, weekStartOf } from './dates.js';
import { weekSummary, planWeekFor } from './stats.js';
import { masteryAll } from './mastery.js';
import { forecast, mockDiff } from './forecast.js';
import { dataBefore, levelChanges } from './weekly.js';

export const REPORT_VERSION = 1;

const round1 = (x) => Math.round(x * 10) / 10;

export function buildWeeklyReport({ data, topics, config, plan, holidays, today, appVersion, now = new Date() }) {
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (d) => d >= weekStart && d <= weekEnd;
  const pw = planWeekFor(plan, today);
  const time = weekSummary(data.sessions, config, holidays, weekStart);

  // 論点ごと：今週の解答数・正答率・目安時間内の割合・レベルの変化
  const changes = levelChanges(topics, data, config, weekStart, today);
  const attempts = data.attempts.filter((a) => inWeek(a.date));
  const topicRows = [];
  for (const t of topics) {
    const list = attempts.filter((a) => a.topicId === t.id);
    const planned = pw.week ? pw.week.topics.includes(t.id) : false;
    const c = changes[t.id];
    if (!list.length && !planned && c.before === c.after) continue;
    topicRows.push({
      topicId: t.id, name: t.name, inPlanThisWeek: planned,
      attempts: list.length,
      rate: list.length ? round1(list.reduce((s, a) => s + a.score, 0) / list.length * 100) : null,
      levelBefore: c.before, levelAfter: c.after,
    });
  }

  // 間違えた問題（今週1回以上間違えた問題。最新の結果が正解でも載せる）
  const wrong = new Map();
  for (const a of attempts) {
    if (a.questionId && a.score < 1) {
      const w = wrong.get(a.questionId) || { questionId: a.questionId, rev: a.qrev ?? null, topicId: a.topicId, times: 0 };
      w.times += 1;
      wrong.set(a.questionId, w);
    }
  }
  const workbookWrong = attempts.filter((a) => a.mode === 'workbook' && a.score < 1)
    .map((a) => ({ ref: a.ref, topicId: a.topicId, score: a.score }));

  const now_ = masteryAll(topics, data, config, today);
  const startData = dataBefore(data, weekStart);
  const start_ = masteryAll(topics, startData, config, addDays(weekStart, -1));
  const fNow = forecast(topics, now_, config);
  const fStart = forecast(topics, start_, config);

  const review = (data.weeklyReviews || []).find((w) => w.weekStart === weekStart) || null;
  const mocks = (data.mocks || []).filter((m) => inWeek(m.date)).map((m) => ({ ...m, diff: mockDiff(m) }));

  return {
    reportVersion: REPORT_VERSION,
    app: 'boki2-app', appVersion: appVersion || null,
    generatedAt: now.toISOString(),
    period: { start: weekStart, end: weekEnd, planWeek: pw.week ? pw.week.week : null, planStatus: pw.status, examDate: config.examDate },
    study: {
      totalMinutes: time.totalActual, targetMinutes: time.totalTarget,
      bySlot: Object.fromEntries(Object.keys(time.actual).map((s) => [s, { actual: time.actual[s], target: time.target[s] }])),
    },
    topics: topicRows,
    wrongQuestions: [...wrong.values()],
    workbookWrong,
    errorReports: (data.errorReports || []).filter((r) => inWeek(r.date)).map((r) => ({ questionId: r.questionId, rev: r.rev, topicId: r.topicId, note: r.note, date: r.date })),
    weeklyReview: review && {
      date: review.date, total: review.total, correct: review.correct, rate: round1(review.rate * 100), seconds: review.sec,
      topics: Object.fromEntries(Object.entries(review.topics).map(([id, r]) => [id, { n: r.n, rate: round1(r.rate * 100), prevRate: r.prevRate == null ? null : round1(r.prevRate * 100) }])),
      wrongIds: review.wrongIds,
    },
    mocks,
    forecast: {
      atWeekStart: round1(fStart.total), now: round1(fNow.total), passScore: config.passScore,
      sections: fNow.sections.map((s) => ({ q: s.q, points: s.points, expected: round1(s.score) })),
    },
    recommendation: review ? review.recommend : null,
  };
}
