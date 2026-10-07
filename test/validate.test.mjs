// 問題データの検証スクリプトが、壊れたデータを検出できることの確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAll } from '../scripts/validate-questions.mjs';
import { validateQuestions, evalExpr } from '../scripts/validate-lib.mjs';

const real = await loadAll();
const clone = (x) => JSON.parse(JSON.stringify(x));
const check = (mutate, { plan = false } = {}) => {
  const input = clone(real);
  if (!plan) input.plan = null;
  mutate(input);
  return validateQuestions(input);
};
const hit = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `該当する検出がありません：${re}\n${errors.join('\n')}`);
const firstOf = (input, type, file = 'c05.json') => input.files[file].questions.find((q) => q.type === type);

test('現在の問題データは検証を通る', () => {
  assert.deepEqual(validateQuestions(clone(real)), []);
});

test('必須項目の欠落を検出する', () => hit(check((i) => { delete i.files['c05.json'].questions[0].explanation; }), /必須項目 explanation/));
test('IDの重複を検出する', () => hit(check((i) => { i.files['c05.json'].questions[1].id = i.files['c05.json'].questions[0].id; }), /IDが重複/));
test('IDの形式の誤りを検出する', () => hit(check((i) => { i.files['c05.json'].questions[0].id = 'c06-001'; }), /IDの形式/));
test('存在しない論点IDを検出する', () => hit(check((i) => { i.files['c05.json'].questions[0].topicId = 'z99'; }), /論点ID z99/));
test('存在しない勘定科目を検出する（答え・選択肢の両方）', () => {
  const e = check((i) => { const q = firstOf(i, 'journal'); q.answer.debit[0].account = '存在しない科目'; q.choices.push('もう一つ存在しない'); });
  hit(e, /勘定科目 存在しない科目 が accounts.json にありません/);
  hit(e, /選択肢の勘定科目 もう一つ存在しない/);
});
test('貸借の不一致を検出する', () => hit(check((i) => { firstOf(i, 'journal').answer.credit[0].amount += 1; }), /貸借が一致しません/));
test('計算式と答えの食い違いを検出する', () => {
  hit(check((i) => { firstOf(i, 'journal').checks.減価償却費 = '1200000 / 4'; }), /checks の 減価償却費：計算結果 300000 が答えの金額 240000/);
  hit(check((i) => { const q = firstOf(i, 'numeric', 'c01.json'); q.answer.value += 1; }), /checks\.value の計算結果/);
});
test('計算式が使えない文字を含むとき・checksが無いとき・答えにない科目を指すときを検出する', () => {
  hit(check((i) => { firstOf(i, 'journal').checks.減価償却費 = 'process.exit()'; }), /使えない文字/);
  hit(check((i) => { delete firstOf(i, 'journal').checks; }), /計算式（checks）がありません/);
  hit(check((i) => { firstOf(i, 'journal').checks.現金 = '1'; }), /checks の 現金 が答えにありません/);
});
test('答えの科目が選択肢にない・同じ科目が二重にあるときを検出する', () => {
  hit(check((i) => { const q = firstOf(i, 'journal'); q.choices = q.choices.filter((c) => c !== q.answer.credit[0].account); }), /が選択肢にありません/);
  hit(check((i) => { const q = firstOf(i, 'journal'); q.answer.debit.push({ ...q.answer.debit[0] }); }), /同じ勘定科目が複数/);
});
test('選択式の範囲外の答え・重複した選択肢を検出する', () => {
  hit(check((i) => { firstOf(i, 'choice', 'c01.json').answer.index = 9; }), /answer\.index/);
  hit(check((i) => { const q = firstOf(i, 'choice', 'c01.json'); q.choices[1] = q.choices[0]; }), /選択肢に重複/);
});
test('verified が真偽値でない・source が original でないときを検出する', () => {
  hit(check((i) => { i.files['c05.json'].questions[0].verified = 'false'; }), /verified/);
  hit(check((i) => { i.files['c05.json'].questions[0].source = '市販テキスト'; }), /source/);
});
test('index.json と実ファイルの食い違いを検出する', () => {
  hit(check((i) => { i.index.files = i.index.files.filter((f) => f !== 'c05.json'); }), /c05\.json: index\.json に載っていません/);
  hit(check((i) => { i.index.files.push('c99.json'); }), /c99\.json: index\.json にあるがファイルがありません/);
});
test('最初の3週分の論点で問題が足りないときを検出する', () => {
  const input = clone(real);
  input.files['c01.json'].questions = input.files['c01.json'].questions.slice(0, 3);
  hit(validateQuestions(input), /plan 第1週 c01.*3問しかありません/);
});
test('計算式の評価は四則演算と括弧だけ', () => {
  assert.equal(evalExpr('(100 - 95) * 1200'), 6000);
  assert.throws(() => evalExpr('alert(1)'));
  assert.throws(() => evalExpr('1 / 0'));
});
