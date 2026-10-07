// 採点（純粋関数）。仕訳は行の順番を問わず、同じ勘定科目は借方・貸方それぞれで合算して比べる
import { sumByAccount } from './journal.js';

/** 入力欄の文字を数値にする。全角数字・カンマ・「円」を許し、読めなければ NaN */
export function parseAmount(text) {
  if (typeof text === 'number') return text;
  const s = String(text ?? '').normalize('NFKC').replace(/[,，、\s円]/g, '').replace(/^[¥￥]/, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

const sameMap = (a, b) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && b[k] === a[k]);
};

/** 利用者の入力（{debit:[{account,amount}], credit:[…]}）を、科目ごとの金額表にする。空行は無視。科目だけで金額が空・0 の行は誤りとして残す */
export function normalizeEntries(entries) {
  const side = (list) => (list || []).map((r) => ({ account: r.account || '', amount: parseAmount(r.amount) }))
    .filter((r) => r.account || (r.amount && !Number.isNaN(r.amount)));
  return { debit: side(entries.debit), credit: side(entries.credit) };
}

export function gradeJournal(q, entries) {
  const user = normalizeEntries(entries);
  const bad = [...user.debit, ...user.credit].some((r) => !r.account || !(r.amount > 0));
  if (bad) return { correct: false, user };
  const ok = sameMap(sumByAccount(user.debit), sumByAccount(q.answer.debit)) && sameMap(sumByAccount(user.credit), sumByAccount(q.answer.credit));
  return { correct: ok, user };
}

export function gradeNumeric(q, text) {
  const v = parseAmount(text);
  return { correct: !Number.isNaN(v) && Math.abs(v - q.answer.value) < 0.005, value: v };
}

export function gradeChoice(q, index) {
  return { correct: Number.isInteger(index) && index === q.answer.index, index };
}

/** response は問題の形式ごと：journal=entries、numeric=入力文字、choice=選んだ番号 */
export function gradeAnswer(q, response) {
  switch (q.type) {
    case 'journal': return gradeJournal(q, response);
    case 'numeric': return gradeNumeric(q, response);
    case 'choice': return gradeChoice(q, response);
    default: throw new Error(`知らない問題の形式: ${q.type}`);
  }
}

export const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
