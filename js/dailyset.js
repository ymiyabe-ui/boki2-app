// 毎日のセットの組み立て（純粋関数）。
// その日の論点（今週の計画の論点）から planned 問 ＋ 再出題 review 問。再出題が足りなければ、習熟度の低い論点から補う。
import { dueItems } from './review.js';

const hash = (s) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
};

/**
 * @param {object} p
 * @param {object[]} p.questions 全問題
 * @param {string[]} p.weekTopicIds 今週の計画の論点（空なら習熟度の低い順に全論点）
 * @param {object} p.mastery topicId → { level }
 * @param {object} p.data 学習データ（attempts・reviewQueue）
 * @param {object} p.config
 * @param {string} p.today 'YYYY-MM-DD'
 * @param {Set<string>} [p.exclude] すでに出した問題ID（「もう1セット」用）
 * @param {number} [p.setNo] 何セット目か（0始まり。並びを変えるための種）
 * @returns {{ q: object, kind: 'review'|'planned'|'fill' }[]}
 */
export function buildSet({ questions, weekTopicIds, mastery, data, config, today, exclude = new Set(), setNo = 0 }) {
  const { planned, review } = config.dailySet;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const topicsWithQ = [...new Set(questions.map((q) => q.topicId))];
  const levelOf = (id) => (mastery[id] ? mastery[id].level : 0);
  const lowFirst = [...topicsWithQ].sort((a, b) => levelOf(a) - levelOf(b) || (a < b ? -1 : 1));

  // 問題ごとの解答履歴
  const tries = new Map();
  for (const a of data.attempts || []) {
    if (!a.questionId) continue;
    const t = tries.get(a.questionId) || { n: 0, last: '', lastScore: 1 };
    t.n += 1;
    if (a.ts >= t.last) { t.last = a.ts; t.lastScore = a.score; }
    tries.set(a.questionId, t);
  }
  const seed = (id) => hash(`${today}:${setNo}:${id}`);
  // 未解答 → 直近で間違えた → 解いてから時間がたったもの の順に、日替わりで並べる
  const rank = (q) => {
    const t = tries.get(q.id);
    return [t ? 1 : 0, t ? t.lastScore : 0, t ? t.last : '', seed(q.id)];
  };
  const cmp = (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  };

  const used = new Set(exclude);
  const out = [];
  const take = (q, kind) => { used.add(q.id); out.push({ q, kind }); };

  // 1) 再出題（予定日が来ているものを古い順）
  const queue = (data.reviewQueue || []);
  for (const item of dueItems(queue, today)) {
    if (out.length >= review) break;
    const q = byId.get(item.questionId);
    if (q && !used.has(q.id)) take(q, 'review');
  }
  // 足りなければ、習熟度の低い論点から補う（すでに触れた論点を優先。まだ何もなければ今週の論点から）
  const touched = lowFirst.filter((id) => levelOf(id) >= 1);
  const fillOrder = touched.length ? touched : weekTopicIds.filter((id) => topicsWithQ.includes(id)).length ? weekTopicIds.filter((id) => topicsWithQ.includes(id)) : lowFirst;
  for (const topicId of fillOrder) {
    if (out.length >= review) break;
    const cands = questions.filter((q) => q.topicId === topicId && !used.has(q.id)).sort(cmp);
    for (const q of cands) {
      if (out.length >= review) break;
      take(q, 'review');
    }
  }

  // 2) その日の論点から planned 問。論点をまわしながら取る
  const planTopics = weekTopicIds.filter((id) => topicsWithQ.includes(id));
  const base = planTopics.length ? planTopics : lowFirst;
  const pools = base.map((id) => questions.filter((q) => q.topicId === id && !used.has(q.id)).sort(cmp));
  const target = out.length + planned;
  // 未解答の問題を先に、論点をまわしながら取る。足りなければ解いたことのある問題から
  for (const fresh of [true, false]) {
    const lists = pools.map((p) => p.filter((q) => !tries.has(q.id) === fresh));
    let guard = 0;
    while (out.length < target && lists.some((p) => p.length) && guard++ < 1000) {
      for (const p of lists) {
        if (out.length >= target) break;
        const q = p.shift();
        if (q) take(q, 'planned');
      }
    }
  }
  // 3) それでも足りなければ、他の論点（習熟度の低い順）から補う
  if (out.length < target) {
    for (const topicId of lowFirst) {
      const cands = questions.filter((q) => q.topicId === topicId && !used.has(q.id)).sort(cmp);
      for (const q of cands) {
        if (out.length >= target) break;
        take(q, 'fill');
      }
      if (out.length >= target) break;
    }
  }
  // 再出題 → 通常の順に並べる（順序はすでにその順）
  return out;
}
