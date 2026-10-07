// ミニテスト画面の通し確認。ブラウザの代わりに最小限の疑似DOMで、開始 → 解答 → 答え合わせ → 次へ → まとめ を操作する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Node_ { }
class El extends Node_ {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.value = ''; this.disabled = false; this.classes = new Set(); this.parent = null; }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get classList() { return { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  append(...cs) { for (const c of cs) { if (c instanceof El) c.parent = this; this.children.push(c); } }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  focus() {}
  get text() { return this.children.map((c) => (typeof c === 'string' ? c : c.text)).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  click() { for (const f of this.listeners.click || []) f({}); }
}
globalThis.Node = Node_;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (s) => String(s), body: new El('body') };
globalThis.window = { scrollTo() {} };
globalThis.setTimeout = (f) => 0; // toast のアニメーション用

const { renderQuiz } = await import('../js/views/quiz.js');
const { createStore } = await import('../js/store.js');
const { loadAll } = await import('../scripts/validate-questions.mjs');
const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const { files, topics, plan } = await loadAll();
const questions = Object.values(files).flatMap((f) => f.questions);
const holidays = {};

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkCtx = () => ({
  store: createStore(mem(), { now: () => new Date('2026-10-06T12:00:00') }).load(),
  topics, config, plan, holidays, questions, quiz: null,
  today: () => '2026-10-06', now: () => new Date('2026-10-06T12:00:00'), refresh() {},
});
const byText = (root, tag, text) => root.all((e) => e.tag === tag && e.text.includes(text))[0];

test('画面の通し：セット開始 → 全問を答える → まとめ。正解は○、間違いは再出題の予定に入る', () => {
  const ctx = mkCtx();
  const root = renderQuiz(ctx);
  byText(root, 'button', '今日のセットを始める').click();
  assert.equal(ctx.quiz.items.length, 8);

  let wrongId = null;
  for (let n = 0; n < 8; n++) {
    const { q } = ctx.quiz.items[ctx.quiz.i];
    const wrongThis = n === 0; // 最初の1問だけ間違える
    if (q.type === 'choice') {
      const idx = wrongThis ? (q.answer.index + 1) % q.choices.length : q.answer.index;
      root.all((e) => e.tag === 'button' && e.classes.has('choice'))[idx].click();
    } else if (q.type === 'numeric') {
      const input = root.all((e) => e.tag === 'input')[0];
      input.value = wrongThis ? '1' : String(q.answer.value);
    } else {
      const fill = (row, account, amount) => { const [sel, amt] = row.all((e) => e.tag === 'select' || e.tag === 'input'); sel.value = account; amt.value = String(amount); };
      const adds = root.all((e) => e.tag === 'button' && e.text.includes('行を追加'));
      for (let k = 2; k < q.answer.debit.length; k++) adds[0].click();
      for (let k = 2; k < q.answer.credit.length; k++) adds[1].click();
      const rows = root.all((e) => e.classes.has('jrow'));
      const nD = Math.max(2, q.answer.debit.length);
      q.answer.debit.forEach((x, i) => fill(rows[i], wrongThis ? '現金' : x.account, x.amount));
      q.answer.credit.forEach((x, i) => fill(rows[nD + i], x.account, x.amount));
    }
    byText(root, 'button', '答え合わせ').click();
    assert.ok(ctx.quiz.shown, `${q.id} の答え合わせが表示されない`);
    assert.equal(ctx.quiz.shown.correct, !wrongThis, `${q.id} の採点`);
    if (wrongThis) wrongId = q.id;
    // 答え合わせ画面：正誤・解説・誤り報告ボタン・次へが出ている
    const text = root.text;
    assert.ok(text.includes(wrongThis ? '不正解' : '正解'));
    assert.ok(text.includes(q.explanation));
    assert.ok(byText(root, 'button', '誤りを報告'));
    byText(root, 'button', n === 7 ? '結果を見る' : '次の問題へ').click();
  }
  assert.equal(ctx.quiz.phase, 'done');
  assert.ok(root.text.includes('7 / 8 問正解'));
  assert.equal(ctx.store.data.attempts.length, 8);
  assert.deepEqual(ctx.store.data.reviewQueue.map((x) => x.questionId), [wrongId]);
  assert.equal(ctx.store.data.reviewQueue[0].due, '2026-10-07');
});

test('誤り報告を保存できる。入力が空なら保存しない', () => {
  const ctx = mkCtx();
  const root = renderQuiz(ctx);
  byText(root, 'button', '今日のセットを始める').click();
  const { q } = ctx.quiz.items[0];
  // 何か答えて答え合わせへ
  if (q.type === 'choice') root.all((e) => e.classes.has('choice'))[0].click();
  else if (q.type === 'numeric') root.all((e) => e.tag === 'input')[0].value = '1';
  else { const [sel, amt] = root.all((e) => e.classes.has('jrow'))[0].all((e) => e.tag === 'select' || e.tag === 'input'); sel.value = '現金'; amt.value = '1'; }
  byText(root, 'button', '答え合わせ').click();
  byText(root, 'button', '誤りを報告').click();
  const ta = root.all((e) => e.tag === 'textarea')[0];
  byText(root, 'button', '報告を保存').click(); // 空のまま
  assert.equal(ctx.store.data.errorReports.length, 0);
  ta.value = '解説の数字が違う';
  byText(root, 'button', '報告を保存').click();
  assert.equal(ctx.store.data.errorReports.length, 1);
  assert.equal(ctx.store.data.errorReports[0].questionId, q.id);
  assert.equal(ctx.store.data.errorReports[0].rev, q.rev);
});

test('何も入力せずに答え合わせしても記録されない', () => {
  const ctx = mkCtx();
  const root = renderQuiz(ctx);
  byText(root, 'button', '今日のセットを始める').click();
  byText(root, 'button', '答え合わせ').click();
  assert.equal(ctx.store.data.attempts.length, 0);
  assert.equal(ctx.quiz.shown, null);
});
