// 習熟度の判定（純粋関数）。ルールの正本は CLAUDE.md の「4. 習熟度と合格見込み」、しきい値は data/config.json
import { diffDays } from './dates.js';

export const LEVEL_NAMES = ['未学習', '読んだ', '例題が解ける', '時間内に解ける', '安定'];

/** 得点（1 / 0.5 / 0）を記号にする */
export const scoreMark = (s) => (s >= 1 ? '○' : s > 0 ? '△' : '×');

const byTsDesc = (a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0);
const norm = (s) => String(s ?? '').trim().normalize('NFKC').toLowerCase();

/** 同じ問題かどうかの判定キー。ミニテストは問題ID、問題集は書名・ページ・番号 */
export function refKey(a) {
  if (a.questionId) return `q:${a.questionId}`;
  const r = a.ref || {};
  return `w:${norm(r.book)}|${norm(r.page)}|${norm(r.no)}`;
}

/** 7日以上あけた再出題で正解した記録があるか */
function hasSpacedRetry(attempts, minGapDays) {
  const sorted = [...attempts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = new Map();
  for (const a of sorted) {
    const k = refKey(a);
    if (!first.has(k)) {
      first.set(k, a.date);
      continue;
    }
    if (a.score >= 1 && diffDays(first.get(k), a.date) >= minGapDays) return true;
  }
  return false;
}

/** 週末総復習で、連続した週に基準以上だったか（weeklyReviews: [{ weekStart, topics: { c05: { rate } } }]） */
function weeklyStreak(reviews, topicId, threshold, weeks) {
  const rows = (reviews || [])
    .filter((r) => r.topics && r.topics[topicId] != null)
    .map((r) => ({ weekStart: r.weekStart, rate: r.topics[topicId].rate ?? r.topics[topicId] }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  let run = 0;
  let prev = null;
  for (const r of rows) {
    if (r.rate >= threshold) run = prev && diffDays(prev, r.weekStart) === 7 ? run + 1 : 1;
    else run = 0;
    prev = r.weekStart;
    if (run >= weeks) return true;
  }
  return false;
}

/**
 * 論点ひとつの習熟度。
 * 正答率の母数は、その論点の直近 recentN 件の解答（問題集ログ＋ミニテスト）。
 * 勉強時間の記録（sessions）はレベルに影響せず、「最後に触れた日」だけに使う。
 */
export function computeMastery(topicId, data, config, today) {
  const m = config.mastery;
  const min = config.minAttempts || { level2: 1, level3: 1, level4: 1 };
  const all = (data.attempts || []).filter((a) => a.topicId === topicId);
  const recent = [...all].sort(byTsDesc).slice(0, m.recentN);
  const n = recent.length;
  const rate = n ? recent.reduce((s, a) => s + a.score, 0) / n : null;
  const inTimeRatio = n ? recent.filter((a) => a.inTime === true).length / n : null;
  const mark = (data.topicMarks || {})[topicId] || null;
  const spaced = hasSpacedRetry(all, m.level4MinGapDays);
  const weeklyOk = weeklyStreak(data.weeklyReviews, topicId, m.level4Rate, m.level4Weeks);

  let level = 0;
  if (mark || n > 0) level = 1;
  if (n >= min.level2 && rate >= m.level2Rate) level = 2;
  const l3 = n >= min.level3 && rate >= m.level3Rate && inTimeRatio >= m.level3InTimeRatio;
  if (l3) level = 3;
  if (l3 && n >= min.level4 && (spaced || weeklyOk)) level = 4;

  const dates = [
    ...all.map((a) => a.date),
    mark && mark.readDate,
    ...(data.sessions || []).filter((s) => s.topicId === topicId).map((s) => s.date),
  ].filter(Boolean);
  const lastTouched = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  const daysSince = lastTouched ? diffDays(lastTouched, today) : null;
  const stale = level >= 1 && daysSince !== null && daysSince >= m.staleDays;

  return { topicId, level, n, rate, inTimeRatio, marked: !!mark, spaced, weeklyOk, lastTouched, daysSince, stale };
}

export function masteryAll(topics, data, config, today) {
  const out = {};
  for (const t of topics) out[t.id] = computeMastery(t.id, data, config, today);
  return out;
}

/** 再挑戦リスト：同じ問題の最新の結果が ○ でないもの（△・×）。新しい順 */
export function retryList(attempts) {
  const latest = new Map();
  const tries = new Map();
  for (const a of [...attempts].sort(byTsDesc)) {
    const k = refKey(a);
    tries.set(k, (tries.get(k) || 0) + 1);
    if (!latest.has(k)) latest.set(k, a);
  }
  return [...latest.entries()]
    .filter(([, a]) => a.score < 1)
    .map(([key, a]) => ({ key, ref: a.ref, questionId: a.questionId || null, topicId: a.topicId, score: a.score, date: a.date, tries: tries.get(key) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 次のレベルに上がる条件の説明文 */
export function nextLevelHint(level, config) {
  const m = config.mastery;
  const min = config.minAttempts;
  const pct = (x) => `${Math.round(x * 100)}%`;
  switch (level) {
    case 0:
      return '「テキストを読んだ」にチェックするか、問題を解くとレベル1になります。';
    case 1:
      return `直近の解答が${min.level2}問以上あり、正答率が${pct(m.level2Rate)}以上でレベル2です。`;
    case 2:
      return `直近の解答が${min.level3}問以上あり、正答率が${pct(m.level3Rate)}以上で、その${pct(m.level3InTimeRatio)}以上が目安時間内でレベル3です。`;
    case 3:
      return `レベル3の状態で、${m.level4MinGapDays}日以上あけた再挑戦で○を取るか、週末の総復習で${m.level4Weeks}週続けて${pct(m.level4Rate)}以上でレベル4です。`;
    default:
      return '最高レベルです。';
  }
}
