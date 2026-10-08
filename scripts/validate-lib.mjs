// 問題データの検証（純粋関数）。CLI は scripts/validate-questions.mjs
// 渡すもの：{ files: { 'c05.json': {topicId, questions[]}, ... }, index: {files[]}, topics: [], accounts: [], plan }
// 返すもの：エラー文字列の配列（空なら問題なし）

const REQUIRED = ['id', 'rev', 'domain', 'exam', 'topicId', 'type', 'difficulty', 'targetSec', 'prompt', 'explanation', 'source', 'verified'];
const TYPES = ['journal', 'choice', 'numeric'];
const SAFE_EXPR = /^[0-9+\-*/().\s]+$/;

/** 計算式を評価する。数字と四則演算・括弧だけを許す */
export function evalExpr(expr) {
  if (typeof expr !== 'string' || !SAFE_EXPR.test(expr)) throw new Error(`使えない文字を含む計算式: ${expr}`);
  const v = Function(`"use strict"; return (${expr});`)();
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`計算できない式: ${expr}`);
  return v;
}

const sameNumber = (a, b) => Math.abs(a - b) < 0.005;

export function validateQuestions({ files, index, topics, accounts, plan, minPerPlannedTopic = 8, plannedWeeks = 3 }) {
  const errors = [];
  const topicIds = new Set(topics.map((t) => t.id));
  const accountSet = new Set(accounts.map((a) => a.name));
  const seen = new Map();
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  // 索引と実ファイルの一致
  const listed = new Set((index && index.files) || []);
  for (const f of Object.keys(files)) if (!listed.has(f)) err(f, 'index.json に載っていません');
  for (const f of listed) if (!(f in files)) err(f, 'index.json にあるがファイルがありません');

  const counts = {};
  for (const [file, body] of Object.entries(files)) {
    if (!body || !Array.isArray(body.questions)) { err(file, 'questions 配列がありません'); continue; }
    const fileTopic = file.replace(/\.json$/, '');
    if (!topicIds.has(fileTopic)) err(file, `論点ID ${fileTopic} が topics.json にありません`);
    if (body.topicId !== fileTopic) err(file, `topicId がファイル名と違います（${body.topicId}）`);
    counts[fileTopic] = body.questions.length;

    for (const q of body.questions) {
      const w = `${file} ${q && q.id}`;
      if (!q || typeof q !== 'object') { err(file, '問題がオブジェクトではありません'); continue; }
      for (const k of REQUIRED) if (q[k] === undefined || q[k] === null || q[k] === '') err(w, `必須項目 ${k} がありません`);
      if (q.id) {
        if (seen.has(q.id)) err(w, `IDが重複しています（${seen.get(q.id)}）`);
        seen.set(q.id, file);
        if (!new RegExp(`^${fileTopic}-\\d{3}$`).test(q.id)) err(w, `IDの形式が ${fileTopic}-NNN ではありません`);
      }
      if (q.topicId !== fileTopic) err(w, `topicId ${q.topicId} がファイルの論点と違います`);
      if (!topicIds.has(q.topicId)) err(w, `論点ID ${q.topicId} が存在しません`);
      if (!TYPES.includes(q.type)) { err(w, `type が不正です（${q.type}）`); continue; }
      if (q.source !== 'original') err(w, 'source は "original" にしてください');
      if (typeof q.verified !== 'boolean') err(w, 'verified は true/false です');
      if (!Number.isInteger(q.rev) || q.rev < 1) err(w, 'rev は1以上の整数です');
      if (![1, 2, 3].includes(q.difficulty)) err(w, 'difficulty は1〜3です');
      if (!(q.targetSec > 0)) err(w, 'targetSec は正の数です');

      if (q.type === 'journal') validateJournal(q, w, accountSet, err);
      else if (q.type === 'choice') validateChoice(q, w, err);
      else validateNumeric(q, w, err);
    }
  }

  // 学習計画の最初の数週分の論点に、問題が足りているか
  if (plan) {
    for (const wk of plan.weeks.slice(0, plannedWeeks)) {
      for (const id of wk.topics) {
        const n = counts[id] || 0;
        if (n < minPerPlannedTopic) err(`plan 第${wk.week}週 ${id}`, `問題が${n}問しかありません（${minPerPlannedTopic}問以上）`);
      }
    }
  }
  return errors;
}

function sumSide(list, account) {
  return list.filter((x) => x.account === account).reduce((a, x) => a + x.amount, 0);
}

function validateJournal(q, w, accountSet, err) {
  const a = q.answer;
  if (!a || !Array.isArray(a.debit) || !Array.isArray(a.credit) || !a.debit.length || !a.credit.length) { err(w, '仕訳の借方・貸方がありません'); return; }
  for (const [side, list] of [['借方', a.debit], ['貸方', a.credit]]) {
    for (const x of list) {
      if (!accountSet.has(x.account)) err(w, `${side}の勘定科目 ${x.account} が accounts.json にありません`);
      if (!Number.isInteger(x.amount) || x.amount <= 0) err(w, `${side}の ${x.account} の金額が正の整数ではありません`);
    }
    const names = list.map((x) => x.account);
    if (new Set(names).size !== names.length) err(w, `${side}に同じ勘定科目が複数あります（まとめてください）`);
  }
  const d = a.debit.reduce((s, x) => s + x.amount, 0);
  const c = a.credit.reduce((s, x) => s + x.amount, 0);
  if (d !== c) err(w, `貸借が一致しません（借方${d}・貸方${c}）`);

  if (!Array.isArray(q.choices) || q.choices.length < 2) { err(w, '選択肢（勘定科目）がありません'); }
  else {
    if (new Set(q.choices).size !== q.choices.length) err(w, '選択肢に重複があります');
    for (const x of q.choices) if (!accountSet.has(x)) err(w, `選択肢の勘定科目 ${x} が accounts.json にありません`);
    for (const x of [...a.debit, ...a.credit]) if (!q.choices.includes(x.account)) err(w, `答えの ${x.account} が選択肢にありません`);
  }

  if (!q.checks || typeof q.checks !== 'object' || !Object.keys(q.checks).length) { err(w, '計算式（checks）がありません'); return; }
  for (const [acct, expr] of Object.entries(q.checks)) {
    const onDebit = a.debit.some((x) => x.account === acct);
    const onCredit = a.credit.some((x) => x.account === acct);
    if (!onDebit && !onCredit) { err(w, `checks の ${acct} が答えにありません`); continue; }
    if (onDebit && onCredit) { err(w, `${acct} は借方・貸方の両方にあるため checks を付けられません`); continue; }
    let v;
    try { v = evalExpr(expr); } catch (e) { err(w, `checks の ${acct}：${e.message}`); continue; }
    const actual = sumSide(onDebit ? a.debit : a.credit, acct);
    if (!sameNumber(v, actual)) err(w, `checks の ${acct}：計算結果 ${v} が答えの金額 ${actual} と違います（式: ${expr}）`);
  }
}

function validateChoice(q, w, err) {
  if (!Array.isArray(q.choices) || q.choices.length < 2) { err(w, '選択肢が2つ以上必要です'); return; }
  if (new Set(q.choices).size !== q.choices.length) err(w, '選択肢に重複があります');
  const i = q.answer && q.answer.index;
  if (!Number.isInteger(i) || i < 0 || i >= q.choices.length) err(w, 'answer.index が選択肢の範囲外です');
}

function validateNumeric(q, w, err) {
  const a = q.answer;
  if (!a || typeof a.value !== 'number' || !Number.isFinite(a.value)) { err(w, 'answer.value が数値ではありません'); return; }
  if (!a.unit) err(w, 'answer.unit（単位）がありません');
  if (!q.checks || !q.checks.value) { err(w, '計算式（checks.value）がありません'); return; }
  try {
    const v = evalExpr(q.checks.value);
    if (!sameNumber(v, a.value)) err(w, `checks.value の計算結果 ${v} が答え ${a.value} と違います（式: ${q.checks.value}）`);
  } catch (e) { err(w, `checks.value：${e.message}`); }
}

// ---------- 講義データ ----------
// 渡すもの：{ lessons: { 'c01.json': {...} }, lessonIndex: {files[]}, files(問題), topics, accounts }
// 講義の形：{ topicId, rev, source, verified, minutes, summary, sections: [{ heading, blocks: [...] }], checkIds: [] }
// ブロック：{t:'p',text} / {t:'list',items} / {t:'tip',text} / {t:'journal',title,debit:[[科目,金額]],credit:[[科目,金額]],note?}
const LESSON_REQUIRED = ['topicId', 'rev', 'source', 'verified', 'minutes', 'summary', 'sections', 'checkIds'];

export function validateLessons({ lessons = {}, lessonIndex, files = {}, topics, accounts }) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const topicIds = new Set(topics.map((t) => t.id));
  const accountSet = new Set(accounts.map((a) => a.name));
  const questionTopic = new Map();
  for (const body of Object.values(files)) for (const q of body.questions || []) questionTopic.set(q.id, q.topicId);

  const listed = new Set((lessonIndex && lessonIndex.files) || []);
  for (const f of Object.keys(lessons)) if (!listed.has(f)) err(f, 'lessons/index.json に載っていません');
  for (const f of listed) if (!(f in lessons)) err(f, 'lessons/index.json にあるがファイルがありません');

  for (const [file, l] of Object.entries(lessons)) {
    const fileTopic = file.replace(/\.json$/, '');
    for (const k of LESSON_REQUIRED) if (l[k] === undefined || l[k] === null || l[k] === '') err(file, `必須項目 ${k} がありません`);
    if (!topicIds.has(fileTopic)) err(file, `論点ID ${fileTopic} が topics.json にありません`);
    if (l.topicId !== fileTopic) err(file, `topicId がファイル名と違います（${l.topicId}）`);
    if (l.source !== 'original') err(file, 'source は "original" にしてください');
    if (typeof l.verified !== 'boolean') err(file, 'verified は true/false です');
    if (!Number.isInteger(l.rev) || l.rev < 1) err(file, 'rev は1以上の整数です');
    if (!(l.minutes > 0)) err(file, 'minutes は正の数です');
    if (!Array.isArray(l.sections) || !l.sections.length) { err(file, 'sections がありません'); continue; }
    l.sections.forEach((s, si) => {
      const w = `${file} 節${si + 1}`;
      if (!s.heading) err(w, 'heading がありません');
      if (!Array.isArray(s.blocks) || !s.blocks.length) { err(w, 'blocks がありません'); return; }
      s.blocks.forEach((b, bi) => {
        const wb = `${w} ブロック${bi + 1}`;
        if (b.t === 'p' || b.t === 'tip') { if (!b.text) err(wb, 'text がありません'); }
        else if (b.t === 'list') { if (!Array.isArray(b.items) || !b.items.length) err(wb, 'items がありません'); }
        else if (b.t === 'journal') validateLessonJournal(b, wb, accountSet, err);
        else err(wb, `t が不正です（${b.t}）`);
      });
    });
    if (!Array.isArray(l.checkIds) || l.checkIds.length < 2 || l.checkIds.length > 3) err(file, 'checkIds は2〜3問にしてください');
    else for (const id of l.checkIds) {
      if (!questionTopic.has(id)) err(file, `確認の問題 ${id} が問題データにありません`);
      else if (questionTopic.get(id) !== fileTopic) err(file, `確認の問題 ${id} は別の論点の問題です`);
    }
  }
  return errors;
}

function validateLessonJournal(b, w, accountSet, err) {
  let total = { debit: 0, credit: 0 };
  for (const side of ['debit', 'credit']) {
    if (!Array.isArray(b[side]) || !b[side].length) { err(w, `${side === 'debit' ? '借方' : '貸方'}がありません`); continue; }
    for (const row of b[side]) {
      const [account, amount] = row;
      if (!accountSet.has(account)) err(w, `勘定科目 ${account} が accounts.json にありません`);
      if (!Number.isInteger(amount) || amount <= 0) err(w, `${account} の金額が正の整数ではありません`);
      else total[side] += amount;
    }
  }
  if (total.debit !== total.credit) err(w, `貸借が一致しません（借方${total.debit}・貸方${total.credit}）`);
}
