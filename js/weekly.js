// 週末の総復習（純粋関数）：セットの組み立て・結果の集計・来週の推奨
import { makeRanker } from './dailyset.js';
import { computeMastery } from './mastery.js';
import { addDays, weekStartOf } from './dates.js';

/** 総復習のセット：今週の論点を currentWeekRatio、残りを過去の論点（習熟度の低い順）から出す */
export function buildWeeklySet({ questions, weekTopicIds, pastTopicIds, mastery, data, config, today }) {
  const total = config.weeklyReview.total;
  const nCurrent = Math.round(total * config.weeklyReview.currentWeekRatio);
  const { tries, cmp } = makeRanker(data, `weekly:${weekStartOf(today)}`);
  const levelOf = (id) => (mastery[id] ? mastery[id].level : 0);
  const withQ = new Set(questions.map((q) => q.topicId));
  const used = new Set();
  const out = [];
  const take = (q, kind) => { used.add(q.id); out.push({ q, kind }); };

  // 論点をまわしながら取る（未解答の問題を先に、足りなければ解いたことのある問題）
  const pick = (topicIds, limit, kind) => {
    const target = out.length + limit;
    const pools = topicIds.map((id) => questions.filter((q) => q.topicId === id && !used.has(q.id)).sort(cmp));
    for (const fresh of [true, false]) {
      const lists = pools.map((p) => p.filter((q) => !tries.has(q.id) === fresh));
      let guard = 0;
      while (out.length < target && lists.some((p) => p.length) && guard++ < 1000) {
        for (const p of lists) {
          if (out.length >= target) break;
          const q = p.shift();
          if (q && !used.has(q.id)) take(q, kind);
        }
      }
    }
  };

  const current = weekTopicIds.filter((id) => withQ.has(id));
  // 過去の論点：計画の前の週の論点と、すでに触れた論点。習熟度の低い順
  const past = [...new Set(pastTopicIds)].filter((id) => withQ.has(id) && !current.includes(id))
    .sort((a, b) => levelOf(a) - levelOf(b) || (a < b ? -1 : 1));
  pick(current, nCurrent, 'current');
  pick(past, total - nCurrent, 'past');
  // 片方が足りなければ、もう片方と他の論点で補って total に近づける
  if (out.length < total) pick(current, total - out.length, 'current');
  if (out.length < total) pick(past, total - out.length, 'past');
  if (out.length < total) {
    const rest = [...withQ].filter((id) => !current.includes(id) && !past.includes(id)).sort((a, b) => levelOf(a) - levelOf(b) || (a < b ? -1 : 1));
    pick(rest, total - out.length, 'past');
  }
  return out;
}

/** 過去の論点の候補：計画で今週より前の週の論点 ＋ すでに解答・読了のある論点 */
export function pastTopicIds({ plan, planIndex, topics, data }) {
  const earlier = plan.weeks.slice(0, Math.max(0, planIndex)).flatMap((w) => w.topics);
  const touched = new Set([...(data.attempts || []).map((a) => a.topicId), ...Object.keys(data.topicMarks || {})]);
  return topics.filter((t) => earlier.includes(t.id) || touched.has(t.id)).map((t) => t.id);
}

/** 来週の推奨：正答率が redoBelow 未満の論点は「やり直し」、advanceAbove 以上があれば次の論点を前倒し候補に */
export function recommend({ topicResults, plan, planIndex, config }) {
  const { redoBelow, advanceAbove } = config.weeklyDecision;
  const redo = Object.entries(topicResults).filter(([, r]) => r.n > 0 && r.rate < redoBelow).map(([id]) => id).sort();
  const strong = Object.entries(topicResults).filter(([, r]) => r.n > 0 && r.rate >= advanceAbove).map(([id]) => id).sort();
  let advance = [];
  if (strong.length && planIndex >= 0) {
    // 今週の次の週以降で、まだ割り当てがある論点を先頭から、90%以上の論点の数だけ（最大2）
    const upcoming = plan.weeks.slice(planIndex + 1).flatMap((w) => w.topics).filter((id) => !(id in topicResults));
    advance = upcoming.slice(0, Math.min(2, strong.length));
  }
  return { redo, strong, advance };
}

/** 総復習の結果を weeklyReviews の1件にまとめる。results: [{ q, correct, sec, kind }] */
export function summarizeWeekly({ results, topics, data, config, today, planIndex, plan, weekNo }) {
  const weekStart = weekStartOf(today);
  const by = {};
  for (const r of results) {
    const t = (by[r.q.topicId] ||= { n: 0, correct: 0, sec: 0 });
    t.n += 1;
    t.correct += r.correct ? 1 : 0;
    t.sec += r.sec;
  }
  const topicResults = {};
  for (const [id, t] of Object.entries(by)) topicResults[id] = { n: t.n, correct: t.correct, rate: t.correct / t.n, sec: t.sec };
  const prev = (data.weeklyReviews || []).filter((w) => w.weekStart < weekStart).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  const prevOf = (id) => { const w = prev.find((x) => x.topics && x.topics[id] != null); return w ? (w.topics[id].rate ?? w.topics[id]) : null; };
  for (const [id, r] of Object.entries(topicResults)) r.prevRate = prevOf(id);
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  return {
    weekStart, weekNo: weekNo ?? null, date: today, total, correct,
    rate: total ? correct / total : 0,
    sec: results.reduce((a, r) => a + r.sec, 0),
    topics: topicResults,
    questionIds: results.map((r) => r.q.id),
    wrongIds: results.filter((r) => !r.correct).map((r) => r.q.id),
    recommend: recommend({ topicResults, plan, planIndex, config }),
  };
}

/** ある日付より前の記録だけにした学習データ（週の初めの習熟度を出すため） */
export function dataBefore(data, ymd) {
  return {
    ...data,
    attempts: data.attempts.filter((a) => a.date < ymd),
    sessions: data.sessions.filter((s) => s.date < ymd),
    topicMarks: Object.fromEntries(Object.entries(data.topicMarks || {}).filter(([, m]) => !m.readDate || m.readDate < ymd)),
    weeklyReviews: (data.weeklyReviews || []).filter((w) => w.weekStart < ymd),
  };
}

/** 論点ごとの週の初めと今のレベル */
export function levelChanges(topics, data, config, weekStart, today) {
  const before = dataBefore(data, weekStart);
  const out = {};
  for (const t of topics) {
    const b = computeMastery(t.id, before, config, addDays(weekStart, -1)).level;
    const a = computeMastery(t.id, data, config, today).level;
    out[t.id] = { before: b, after: a };
  }
  return out;
}
