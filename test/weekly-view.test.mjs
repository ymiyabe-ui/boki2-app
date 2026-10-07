// 週末のページの通し確認（疑似DOM）：総復習20問を解く → 結果・推奨 → 模試の記録 → レポート
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './helpers/fake-dom.mjs';

const { renderQuiz } = await import('../js/views/quiz.js');
const { renderWeekly } = await import('../js/views/weekly.js');
const { createStore } = await import('../js/store.js');
const { loadAll } = await import('../scripts/validate-questions.mjs');
const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const holidays = JSON.parse(await readFile(new URL('../data/holidays.json', import.meta.url), 'utf8')).dates;
const { files, topics, plan } = await loadAll();
const questions = Object.values(files).flatMap((f) => f.questions);

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkCtx = () => ({
  store: createStore(mem(), { now: () => new Date('2026-10-20T12:00:00') }).load(),
  topics, config, plan, holidays, questions, quiz: null,
  today: () => '2026-10-20', now: () => new Date('2026-10-20T12:00:00'), refresh() {},
});
const byText = (root, tag, text) => root.all((e) => e.tag === tag && e.text.includes(text))[0];

function answer(root, q, correct) {
  if (q.type === 'choice') {
    const idx = correct ? q.answer.index : (q.answer.index + 1) % q.choices.length;
    root.all((e) => e.tag === 'button' && e.classes.has('choice'))[idx].click();
  } else if (q.type === 'numeric') {
    root.all((e) => e.tag === 'input')[0].value = correct ? String(q.answer.value) : '1';
  } else {
    const fill = (row, account, amount) => { const [sel, amt] = row.all((e) => e.tag === 'select' || e.tag === 'input'); sel.value = account; amt.value = String(amount); };
    const adds = root.all((e) => e.tag === 'button' && e.text.includes('行を追加'));
    for (let k = 2; k < q.answer.debit.length; k++) adds[0].click();
    for (let k = 2; k < q.answer.credit.length; k++) adds[1].click();
    const rows = root.all((e) => e.classes.has('jrow'));
    const nD = Math.max(2, q.answer.debit.length);
    q.answer.debit.forEach((x, i) => fill(rows[i], correct ? x.account : '現金', x.amount));
    q.answer.credit.forEach((x, i) => fill(rows[nD + i], x.account, x.amount));
  }
  byText(root, 'button', '答え合わせ').click();
}

test('総復習：20問を通しで解くと、結果・論点ごとの変化・来週の推奨が出て、保存される', () => {
  const ctx = mkCtx();
  const page = renderWeekly(ctx);
  assert.ok(page.text.includes('合格見込み点'));
  byText(page, 'button', '総復習を始める').click();
  assert.equal(location.hash, '#/quiz');
  assert.equal(ctx.quiz.mode, 'weekly');
  assert.equal(ctx.quiz.items.length, 20);

  const root = renderQuiz(ctx);
  assert.ok(root.text.includes('週末の総復習'));
  assert.ok(root.text.includes('経過時間'));
  const week = plan.weeks[2].topics;
  const wrongTopic = ctx.quiz.items[0].q.topicId; // 最初の論点は全問間違える → やり直しに入る
  for (let n = 0; n < 20; n++) {
    const { q } = ctx.quiz.items[ctx.quiz.i];
    answer(root, q, q.topicId !== wrongTopic);
    byText(root, 'button', n === 19 ? '結果を見る' : '次の問題へ').click();
  }
  assert.equal(ctx.quiz.phase, 'done');
  const text = root.text;
  assert.ok(text.includes('総復習の結果'));
  assert.ok(text.includes('論点ごとの変化'));
  assert.ok(text.includes('来週の推奨'));
  assert.ok(text.includes('やり直し'));
  assert.ok(!text.includes('経過時間'), '終了後は時計を消す');

  const d = ctx.store.data;
  assert.equal(d.weeklyReviews.length, 1);
  assert.equal(d.weeklyReviews[0].total, 20);
  assert.equal(d.weeklyReviews[0].weekStart, '2026-10-19');
  assert.ok(d.weeklyReviews[0].recommend.redo.includes(wrongTopic));
  assert.equal(d.attempts.filter((a) => a.mode === 'weekly').length, 20);
  assert.ok(Object.keys(d.weeklyReviews[0].topics).some((id) => week.includes(id)));

  // もう一度ページを開くと、今週の結果が出ている
  ctx.quiz = null;
  const again = renderWeekly(ctx);
  assert.ok(again.text.includes('今週の結果'));
  assert.ok(byText(again, 'button', '総復習をやり直す'));
});

test('模試の記録：範囲外は保存せず、正しく入れれば予測との差つきで残る', () => {
  const ctx = mkCtx();
  const page = renderWeekly(ctx);
  const form = page.all((e) => e.tag === 'form')[0];
  const inputs = form.all((e) => e.tag === 'input');
  const [date, ...rest] = inputs; // 日付、第1〜5問、時間
  const scoreInputs = rest.slice(0, 5);
  const submit = () => form.listeners.submit[0]({ preventDefault() {} });
  scoreInputs.forEach((el, i) => { el.value = String([18, 12, 14, 20, 8][i]); });
  scoreInputs[0].value = '25'; // 配点超え
  submit();
  assert.equal(ctx.store.data.mocks.length, 0);
  scoreInputs[0].value = '18';
  rest[5].value = '88';
  submit();
  assert.equal(ctx.store.data.mocks.length, 1);
  const m = ctx.store.data.mocks[0];
  assert.equal(m.total, 72);
  assert.equal(m.minutes, 88);
  assert.equal(m.forecastTotal, 0); // 何も学習していない時点の予測
  assert.ok(renderWeekly(ctx).text.includes('予測0.0点との差 +72.0'));
});

test('週次レポートのコピーと保存の対象が JSON で、貼り付けられる', async () => {
  const ctx = mkCtx();
  let copied = null;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied = t; } } }, configurable: true });
  const page = renderWeekly(ctx);
  await byText(page, 'button', 'コピーする').listeners.click[0]({});
  assert.ok(copied, 'クリップボードに書かれていない');
  const rep = JSON.parse(copied);
  assert.equal(rep.app, 'boki2-app');
  assert.equal(rep.period.start, '2026-10-19');
  assert.ok(Array.isArray(rep.topics));
});
