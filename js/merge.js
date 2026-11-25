// 端末間の同期：2つの記録を1つにまとめる純粋関数（ブラウザにも Node にも依存しない）。
// 方針：記録は消さずに足し合わせる。消した記録は meta.deleted（墓標）で伝える。再出題の予定は、解答の履歴から作り直す。
import { applyAnswer } from './review.js';

/** ID つきの履歴（足し合わせる）。weeklyReviews は、同じ週を1件にそろえる */
export const LOG_KEYS = ['sessions', 'attempts', 'mocks', 'errorReports', 'weeklyReviews'];

const tsOf = (r) => r.ts || r.createdAt || '';
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

export function deletedOf(d) {
  return obj(obj(d && d.meta).deleted);
}

/** 墓標を足す（消した記録の ID か、'mark:論点ID'）。後で同じ ID が来ても、足し合わせで復活しない */
export function addTombstone(data, key, iso) {
  if (!data.meta || typeof data.meta !== 'object') data.meta = {};
  if (!data.meta.deleted || typeof data.meta.deleted !== 'object') data.meta.deleted = {};
  data.meta.deleted[key] = iso;
}

/** ID で足し合わせる。墓標のある ID は除く。時刻順に並べ、同じ時刻は自分側の並びを保つ */
function unionById(first, second, dead) {
  const seen = new Set();
  const out = [];
  for (const r of [...arr(first), ...arr(second)]) {
    if (!r || !r.id || seen.has(r.id) || dead[r.id]) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out
    .map((r, i) => [r, i])
    .sort((a, b) => (tsOf(a[0]) < tsOf(b[0]) ? -1 : tsOf(a[0]) > tsOf(b[0]) ? 1 : a[1] - b[1]))
    .map((x) => x[0]);
}

/** 同じ週の総復習は、いちばん新しい1件だけ残す */
function latestPerWeek(list) {
  const best = new Map();
  for (const r of list) {
    const k = r.weekStart;
    if (k == null) { best.set(`id:${r.id}`, r); continue; }
    const cur = best.get(k);
    if (!cur || tsOf(r) >= tsOf(cur)) best.set(k, r);
  }
  const keep = new Set([...best.values()].map((r) => r.id));
  return list.filter((r) => keep.has(r.id));
}

/** 解答の履歴から、再出題の予定を作り直す（問題の解答だけ。問題集ログは questionId がない） */
export function rebuildQueue(attempts, intervals) {
  let q = [];
  const list = arr(attempts).filter((a) => a.questionId).slice().sort((a, b) => (tsOf(a) < tsOf(b) ? -1 : tsOf(a) > tsOf(b) ? 1 : 0));
  for (const a of list) q = applyAnswer(q, { questionId: a.questionId, topicId: a.topicId, correct: a.score === 1, date: a.date }, intervals);
  return q;
}

/**
 * local（この端末）と remote（サーバー）をまとめる。どちらも変えない。
 * intervals（再出題の間隔）があるときだけ、解答が増えた場合に再出題の予定を作り直す。
 * timer と meta.lastBackupAt は、この端末のものを保つ。
 */
export function mergeData(local, remote, { intervals } = {}) {
  const a = local || {};
  const b = remote || {};
  const dead = {};
  for (const [k, v] of Object.entries(deletedOf(b))) if (!dead[k] || v > dead[k]) dead[k] = v;
  for (const [k, v] of Object.entries(deletedOf(a))) if (!dead[k] || v > dead[k]) dead[k] = v;

  const out = { ...a };
  for (const k of LOG_KEYS) out[k] = unionById(a[k], b[k], dead);
  out.weeklyReviews = latestPerWeek(out.weeklyReviews);

  // 読了チェック：新しいほうを採り、消した時刻のほうが新しければ消す
  const marks = {};
  for (const src of [obj(a.topicMarks), obj(b.topicMarks)]) {
    for (const [t, v] of Object.entries(src)) if (!marks[t] || (v.readAt || '') > (marks[t].readAt || '')) marks[t] = v;
  }
  for (const t of Object.keys(marks)) if ((dead[`mark:${t}`] || '') >= (marks[t].readAt || '')) delete marks[t];
  out.topicMarks = marks;

  // 再出題の予定：解答が増えたときだけ、履歴から作り直す
  const ids = (x) => arr(x).map((r) => r.id).sort().join(',');
  const grew = ids(out.attempts) !== ids(a.attempts);
  out.reviewQueue = grew && intervals ? rebuildQueue(out.attempts, intervals) : arr(a.reviewQueue);

  out.schemaVersion = Math.max(a.schemaVersion || 0, b.schemaVersion || 0) || a.schemaVersion;
  const created = [a.createdAt, b.createdAt].filter(Boolean).sort();
  if (created.length) out.createdAt = created[0];
  out.meta = { ...obj(a.meta), deleted: dead };
  return out;
}

/** 記録の中身（履歴の ID・読了・墓標）が同じか。再出題の予定や並び順は見ない */
export function fingerprint(d) {
  const ids = (k) => arr(d && d[k]).map((r) => r.id).sort().join(',');
  const marks = Object.entries(obj(d && d.topicMarks)).map(([k, v]) => `${k}@${v.readAt || ''}`).sort().join(',');
  const del = Object.entries(deletedOf(d)).map(([k, v]) => `${k}@${v}`).sort().join(',');
  return [...LOG_KEYS.map(ids), marks, del].join('|');
}
export const sameContent = (a, b) => fingerprint(a) === fingerprint(b);

export function isEmptyData(d) {
  return LOG_KEYS.every((k) => arr(d && d[k]).length === 0) && Object.keys(obj(d && d.topicMarks)).length === 0 && Object.keys(deletedOf(d)).length === 0;
}

/** サーバーに送る形。タイマー（その端末だけのもの）とバックアップ日時は送らない */
export function forServer(d) {
  return {
    schemaVersion: d.schemaVersion,
    createdAt: d.createdAt,
    sessions: arr(d.sessions),
    attempts: arr(d.attempts),
    reviewQueue: arr(d.reviewQueue),
    topicMarks: obj(d.topicMarks),
    mocks: arr(d.mocks),
    errorReports: arr(d.errorReports),
    weeklyReviews: arr(d.weeklyReviews),
    meta: { deleted: deletedOf(d) },
  };
}
