// 毎日のミニテスト：セットの作成 → 1問ずつ解答 → 答え合わせ（正誤・解説・時間・誤り報告）→ まとめ
import { h, toast, fmtDate, fmtClock } from '../ui.js';
import { buildSet } from '../dailyset.js';
import { gradeAnswer, parseAmount, yen } from '../grade.js';
import { masteryAll } from '../mastery.js';
import { dueItems } from '../review.js';
import { planWeekFor } from '../stats.js';
import { sumByAccount } from '../journal.js';
import { topicName } from './parts.js';
import { buildWeeklySet, pastTopicIds, summarizeWeekly } from '../weekly.js';
import { weeklyResultCard } from './weekly-parts.js';

const KIND_LABEL = { review: '再出題', planned: '今週の論点', fill: '補い', current: '今週の論点', past: '過去の論点' };
const TYPE_LABEL = { journal: '仕訳', choice: '選択式', numeric: '数値入力' };

/** 今日ミニテストで解いた問題ID */
export const answeredToday = (data, today) => data.attempts.filter((a) => a.mode === 'minitest' && a.date === today && a.questionId);

export function dueCount(ctx) {
  const ids = new Set(ctx.questions.map((q) => q.id));
  return dueItems(ctx.store.data.reviewQueue, ctx.today()).filter((x) => ids.has(x.questionId)).length;
}

function startSet(ctx) {
  const { store, config, plan } = ctx;
  const today = ctx.today();
  const done = answeredToday(store.data, today);
  const exclude = new Set(done.map((a) => a.questionId));
  const mastery = masteryAll(ctx.topics, store.data, config, today);
  const pw = planWeekFor(plan, today);
  // 今週の計画の論点。計画の外（開始前・終了後）なら、習熟度の低い論点から
  const weekTopicIds = pw.week ? pw.week.topics : [];
  const setNo = Math.floor(done.length / (config.dailySet.planned + config.dailySet.review));
  const items = buildSet({ questions: ctx.questions, weekTopicIds, mastery, data: store.data, config, today, exclude, setNo });
  if (!items.length) return false;
  ctx.quiz = { mode: 'daily', phase: 'question', items, i: 0, results: [], t0: Date.now(), shown: null };
  return true;
}

/** 週末の総復習（20問：今週の論点6割＋過去の論点4割）を始める */
export function startWeekly(ctx) {
  const { store, config, plan } = ctx;
  const today = ctx.today();
  const mastery = masteryAll(ctx.topics, store.data, config, today);
  const pw = planWeekFor(plan, today);
  const past = pastTopicIds({ plan, planIndex: pw.status === 'after' ? plan.weeks.length : pw.index, topics: ctx.topics, data: store.data });
  const items = buildWeeklySet({ questions: ctx.questions, weekTopicIds: pw.week ? pw.week.topics : [], pastTopicIds: past, mastery, data: store.data, config, today });
  if (!items.length) return false;
  ctx.quiz = { mode: 'weekly', phase: 'question', items, i: 0, results: [], t0: Date.now(), startedAt: Date.now(), shown: null, review: null };
  return true;
}

export function renderQuiz(ctx) {
  const root = h('div', { class: 'view' });
  const body = h('div', { class: 'view' });
  const weekly = ctx.quiz && ctx.quiz.mode === 'weekly';
  root.append(h('h1', null, weekly ? '週末の総復習' : 'ミニテスト'));
  let clock = null;
  let tick = null;
  if (weekly && ctx.quiz.phase !== 'done') {
    // 総復習は通しの時間を計る
    clock = h('div', { class: 'banner info', role: 'timer' }, h('span', null, '経過時間'), h('span', { class: 'timer-text' }, fmtClock(Date.now() - ctx.quiz.startedAt)));
    root.append(clock);
    tick = setInterval(() => { clock.children[1].textContent = fmtClock(Date.now() - ctx.quiz.startedAt); }, 1000);
    root._cleanup = () => clearInterval(tick);
  }
  root.append(body);
  const show = () => {
    const s = ctx.quiz;
    if (clock && s && s.phase === 'done') { clearInterval(tick); clock.remove(); clock = null; }
    body.replaceChildren(...(!s ? [menu(ctx, show)] : s.phase === 'done' ? [summary(ctx, show)] : [question(ctx, show)]));
    window.scrollTo(0, 0);
  };
  show();
  return root;
}

// ---------- メニュー ----------
function menu(ctx, show) {
  const { store, config } = ctx;
  const today = ctx.today();
  const done = answeredToday(store.data, today);
  const due = dueCount(ctx);
  const per = config.dailySet.planned + config.dailySet.review;
  const sets = Math.floor(done.length / per);
  const node = h('div', { class: 'view' });
  if (!ctx.questions.length) {
    node.append(h('div', { class: 'banner bad' }, '問題データを読み込めませんでした。電波の良い場所で開き直してください。'));
    return node;
  }
  node.append(h('div', { class: 'card' },
    h('h2', null, '今日のセット'),
    h('p', null, `今週の論点から${config.dailySet.planned}問 ＋ 再出題${config.dailySet.review}問（全${per}問）。昼休みの1セットが目安です。`),
    h('ul', { class: 'small muted', style: 'margin:6px 0;padding-left:1.2em' },
      h('li', null, `再出題の予定：${due}問（間違えた問題は1日後・3日後・7日後に出ます）`),
      h('li', null, `今日解いた問題：${done.length}問（${fmtDate(today)}）`)),
    h('button', { class: 'primary', style: 'width:100%', onclick: () => { if (startSet(ctx)) show(); else toast('出せる問題がありません'); } },
      sets > 0 || done.length > 0 ? 'もう1セット始める' : '今日のセットを始める')));
  node.append(h('p', { class: 'small muted' }, `問題はすべてオリジナルで、「未確認」と表示されるものはテキストとの照合がまだです。誤りに気づいたら、答え合わせの画面から報告できます。収録：${ctx.questions.length}問。`));
  return node;
}

// ---------- 問題 ----------
function question(ctx, show) {
  const s = ctx.quiz;
  const { q, kind } = s.items[s.i];
  const node = h('div', { class: 'view' });
  const total = s.items.length;

  node.append(h('div', { class: 'row' },
    h('span', { class: 'badge' }, `${s.i + 1} / ${total}`),
    h('span', { class: 'badge' }, KIND_LABEL[kind]),
    h('span', { class: 'badge' }, TYPE_LABEL[q.type]),
    q.verified ? null : h('span', { class: 'badge warn' }, '未確認'),
    h('span', { class: 'small muted grow', style: 'text-align:right' }, topicName(ctx, q.topicId))));

  const card = h('div', { class: 'card' }, h('p', { class: 'prompt' }, q.prompt));
  node.append(card);

  // 入力欄
  let getResponse;
  let controls = [];
  if (q.type === 'journal') {
    const j = journalInput(q);
    getResponse = j.get;
    controls = [j.node];
  } else if (q.type === 'numeric') {
    const input = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: `数値を入力（単位：${q.answer.unit}）`, 'aria-label': '答え' });
    getResponse = () => input.value;
    controls = [h('div', { class: 'card' }, h('div', { class: 'field' }, h('span', { class: 'field-label' }, `答え（${q.answer.unit}）`), input))];
  } else {
    let picked = null;
    const buttons = q.choices.map((c, i) => h('button', { type: 'button', class: 'choice', onclick: () => {
      picked = i;
      buttons.forEach((b, k) => b.classList.toggle('picked', k === i));
    } }, c));
    getResponse = () => picked;
    controls = [h('div', { class: 'card choices' }, buttons)];
  }
  node.append(...controls);

  const submit = h('button', { class: 'primary', style: 'width:100%' }, '答え合わせ');
  submit.addEventListener('click', () => {
    const response = getResponse();
    if (q.type === 'choice' && response === null) { toast('選択肢を選んでください'); return; }
    if (q.type === 'numeric' && Number.isNaN(parseAmount(response))) { toast('数値を入れてください'); return; }
    if (q.type === 'journal' && !hasAnyEntry(response)) { toast('仕訳を入力してください'); return; }
    submit.disabled = true;
    const sec = Math.max(1, Math.round((Date.now() - s.t0) / 1000));
    const g = gradeAnswer(q, response);
    try {
      ctx.store.recordAnswer({ q, correct: g.correct, sec, intervals: ctx.config.reviewIntervalsDays, mode: s.mode === 'weekly' ? 'weekly' : 'minitest' });
    } catch (e) {
      submit.disabled = false;
      toast(`記録できませんでした：${e.message}`);
      return;
    }
    s.results.push({ q, correct: g.correct, sec, kind });
    s.shown = { correct: g.correct, sec, response, grade: g };
    show();
  });
  node.append(submit);

  if (s.shown) return resultView(ctx, node, s, q, show);
  return node;
}

function hasAnyEntry(e) {
  return [...e.debit, ...e.credit].some((r) => r.account || String(r.amount).trim());
}

function journalInput(q) {
  const mkRow = () => {
    const sel = h('select', { 'aria-label': '勘定科目' }, h('option', { value: '' }, '（科目を選ぶ）'), q.choices.map((c) => h('option', { value: c }, c)));
    const amt = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: '金額', 'aria-label': '金額' });
    return { sel, amt, el: h('div', { class: 'jrow' }, sel, amt) };
  };
  const side = { debit: [mkRow(), mkRow()], credit: [mkRow(), mkRow()] };
  const box = (key, title) => {
    const list = h('div', { class: 'jrows' }, side[key].map((r) => r.el));
    return h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, title), list,
      h('button', { type: 'button', class: 'small', onclick: () => { const r = mkRow(); side[key].push(r); list.append(r.el); } }, '＋ 行を追加'));
  };
  return {
    node: h('div', { class: 'view' }, box('debit', '借方'), box('credit', '貸方'),
      h('p', { class: 'hint' }, '行の順番は問いません。同じ科目は合計して採点します。使わない行は空のままで構いません。')),
    get: () => ({
      debit: side.debit.map((r) => ({ account: r.sel.value, amount: r.amt.value })),
      credit: side.credit.map((r) => ({ account: r.sel.value, amount: r.amt.value })),
    }),
  };
}

// ---------- 答え合わせ ----------
function entriesTable(title, map) {
  const rows = Object.entries(map);
  return h('div', { class: 'jside' }, h('div', { class: 'small muted' }, title),
    rows.length ? rows.map(([a, v]) => h('div', { class: 'jline' }, h('span', null, a), h('span', { class: 'num' }, yen(v)))) : h('div', { class: 'muted' }, '（なし）'));
}

function resultView(ctx, node, s, q, show) {
  const sh = s.shown;
  // 回答時の入力はこの画面を作り直すと失われるので、答え合わせでは回答内容を文字で見せる
  const mine = h('div', { class: 'card' });
  if (q.type === 'journal') {
    mine.append(h('h3', { style: 'margin-top:0' }, 'あなたの答え'),
      h('div', { class: 'jtable' },
        entriesTable('借方', sumByAccount(sh.grade.user.debit)),
        entriesTable('貸方', sumByAccount(sh.grade.user.credit))));
  } else if (q.type === 'numeric') {
    mine.append(h('h3', { style: 'margin-top:0' }, 'あなたの答え'), h('p', null, `${sh.response}`));
  } else {
    mine.append(h('h3', { style: 'margin-top:0' }, 'あなたの答え'), h('p', null, q.choices[sh.response] ?? ''));
  }

  const correctCard = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '正解'));
  if (q.type === 'journal') {
    correctCard.append(h('div', { class: 'jtable' },
      entriesTable('借方', sumByAccount(q.answer.debit)), entriesTable('貸方', sumByAccount(q.answer.credit))));
  } else if (q.type === 'numeric') {
    correctCard.append(h('p', { class: 'big-ans' }, `${q.answer.value.toLocaleString('ja-JP')}${q.answer.unit}`));
  } else {
    correctCard.append(h('p', { class: 'big-ans' }, q.choices[q.answer.index]));
  }
  correctCard.append(h('p', null, q.explanation));

  const slow = sh.sec > q.targetSec;
  const banner = h('div', { class: `banner ${sh.correct ? 'ok' : 'bad'}`, role: 'status' },
    h('strong', null, sh.correct ? '⭕ 正解' : '❌ 不正解'),
    h('span', { class: 'small' }, `${sh.sec}秒（目安${q.targetSec}秒）${slow ? '・時間超過' : ''}`));
  if (!sh.correct) banner.append(h('span', { class: 'small' }, '明日、もう一度出ます'));

  const isLast = s.i + 1 >= s.items.length;
  const next = h('button', { class: 'primary', style: 'width:100%', onclick: () => {
    if (isLast) { s.phase = 'done'; } else { s.i += 1; s.shown = null; s.t0 = Date.now(); }
    show();
  } }, isLast ? '結果を見る' : '次の問題へ');

  // 問題文はそのまま、入力欄の代わりに答えを並べる
  const head = node.children[0];
  const prompt = node.children[1];
  node.replaceChildren(head, prompt, banner, mine, correctCard, reportBox(ctx, q), next);
  return node;
}

function reportBox(ctx, q) {
  const wrap = h('div', { class: 'card' });
  const note = h('textarea', { rows: 3, placeholder: '気づいた点（例：解説の金額が計算と合わない、問題文が曖昧）', 'aria-label': '誤り報告のメモ' });
  const send = h('button', { class: 'small', onclick: () => {
    if (!note.value.trim()) { toast('メモを入れてください'); return; }
    ctx.store.addErrorReport({ q, note: note.value });
    wrap.replaceChildren(h('p', { class: 'small muted' }, '誤り報告を保存しました。週次レポートに載ります。'));
  } }, '報告を保存');
  const open = h('button', { class: 'small', onclick: () => { open.remove(); wrap.append(note, h('div', { class: 'row end', style: 'margin-top:8px' }, send)); note.focus(); } }, '🚩 この問題の誤りを報告');
  wrap.append(open);
  return wrap;
}

// ---------- まとめ ----------
function summary(ctx, show) {
  const s = ctx.quiz;
  if (s.mode === 'weekly') return weeklySummary(ctx, s);
  const ok = s.results.filter((r) => r.correct).length;
  const total = s.results.length;
  const sec = s.results.reduce((a, r) => a + r.sec, 0);
  const wrong = s.results.filter((r) => !r.correct);
  const node = h('div', { class: 'view' });
  node.append(h('div', { class: 'card' },
    h('h2', null, 'おつかれさまでした'),
    h('p', { class: 'big-ans' }, `${ok} / ${total} 問正解`),
    h('p', { class: 'small muted' }, `かかった時間：${Math.floor(sec / 60)}分${sec % 60}秒`),
    wrong.length ? h('p', { class: 'small' }, `間違えた${wrong.length}問は、明日もう一度出ます。`) : h('p', { class: 'small' }, '全問正解です。')));
  node.append(h('div', { class: 'card' }, h('h2', null, '結果'),
    h('ul', { class: 'list' }, s.results.map((r) => h('li', null,
      h('span', { class: 'mark' }, r.correct ? '○' : '×'),
      h('div', { class: 'body' }, h('div', { class: 'title' }, `${r.q.id}　${topicName(ctx, r.q.topicId)}`),
        h('div', { class: 'small muted' }, `${r.sec}秒／目安${r.q.targetSec}秒`)))))));
  node.append(h('div', { class: 'row' },
    h('button', { class: 'primary grow', onclick: () => { ctx.quiz = null; if (startSet(ctx)) show(); else { toast('出せる問題がありません'); show(); } } }, 'もう1セット'),
    h('a', { class: 'btn grow', href: '#/', style: 'text-align:center;text-decoration:none', onclick: () => { ctx.quiz = null; } }, 'ホームへ')));
  return node;
}

function weeklySummary(ctx, s) {
  const { store, config, plan } = ctx;
  if (!s.review) {
    const today = ctx.today();
    const pw = planWeekFor(plan, today);
    const review = summarizeWeekly({ results: s.results, topics: ctx.topics, data: store.data, config, today, planIndex: pw.index, plan, weekNo: pw.week ? pw.week.week : null });
    s.review = store.addWeeklyReview(review);
  }
  const node = h('div', { class: 'view' }, weeklyResultCard(ctx, s.review));
  node.append(h('div', { class: 'card' }, h('h2', null, '問題ごとの結果'),
    h('ul', { class: 'list' }, s.results.map((r) => h('li', null,
      h('span', { class: 'mark' }, r.correct ? '○' : '×'),
      h('div', { class: 'body' }, h('div', { class: 'title' }, `${r.q.id}　${topicName(ctx, r.q.topicId)}`),
        h('div', { class: 'small muted' }, `${r.sec}秒／目安${r.q.targetSec}秒`)))))));
  node.append(h('div', { class: 'row' },
    h('a', { class: 'btn primary grow', href: '#/weekly', style: 'text-align:center;text-decoration:none', onclick: () => { ctx.quiz = null; } }, '週末のページへ（レポート）'),
    h('a', { class: 'btn grow', href: '#/', style: 'text-align:center;text-decoration:none', onclick: () => { ctx.quiz = null; } }, 'ホームへ')));
  return node;
}
