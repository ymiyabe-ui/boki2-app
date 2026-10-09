// 講義：データの検証と、講義ページ → 確認の問題 → 「読んだ」が付くまでの通し確認（疑似DOM）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './helpers/fake-dom.mjs';
import { validateLessons } from '../scripts/validate-lib.mjs';

const { renderQuiz, answeredToday } = await import('../js/views/quiz.js');
const { renderLesson } = await import('../js/views/lesson.js');
const { renderTopicDetail } = await import('../js/views/topics.js');
const { createStore } = await import('../js/store.js');
const { loadAll } = await import('../scripts/validate-questions.mjs');
const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const real = await loadAll();
const { files, topics, plan } = real;
const questions = Object.values(files).flatMap((f) => f.questions);
const lessons = Object.fromEntries(Object.values(real.lessons).map((l) => [l.topicId, l]));

const clone = (x) => JSON.parse(JSON.stringify(x));
const check = (mutate) => { const i = clone(real); mutate(i); return validateLessons(i); };
const hit = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `該当する検出がありません：${re}\n${errors.join('\n')}`);

test('現在の講義データは検証を通る', () => assert.deepEqual(validateLessons(clone(real)), []));
test('論点ごとの講義が計画の第1週（c01〜c04）にそろっている', () => {
  for (const id of plan.weeks[0].topics) assert.ok(lessons[id], `${id} の講義がありません`);
});
test('確認の問題が問題データにない・別の論点の問題のときを検出する', () => {
  hit(check((i) => { i.lessons['c01.json'].checkIds[0] = 'c01-999'; }), /c01-999 が問題データにありません/);
  hit(check((i) => { i.lessons['c01.json'].checkIds[0] = 'c02-001'; }), /c02-001 は別の論点/);
  hit(check((i) => { i.lessons['c01.json'].checkIds = ['c01-001']; }), /2〜3問/);
});
test('講義の仕訳例の貸借不一致・存在しない勘定科目を検出する', () => {
  const journal = (i) => i.lessons['c01.json'].sections.flatMap((s) => s.blocks).find((b) => b.t === 'journal');
  hit(check((i) => { journal(i).credit[0][1] += 1; }), /貸借が一致しません/);
  hit(check((i) => { journal(i).debit[0][0] = '存在しない科目'; }), /勘定科目 存在しない科目/);
});
test('必須項目の欠落・索引との食い違い・出典の誤りを検出する', () => {
  hit(check((i) => { delete i.lessons['c01.json'].summary; }), /必須項目 summary/);
  hit(check((i) => { i.lessonIndex.files = i.lessonIndex.files.filter((f) => f !== 'c04.json'); }), /c04\.json: lessons\/index\.json に載っていません/);
  hit(check((i) => { i.lessonIndex.files.push('c99.json'); }), /c99\.json: lessons\/index\.json にあるがファイルがありません/);
  hit(check((i) => { i.lessons['c01.json'].source = '市販テキスト'; }), /source/);
});

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkCtx = () => ({
  store: createStore(mem(), { now: () => new Date('2026-10-06T12:00:00') }).load(),
  topics, config, plan, holidays: {}, questions, lessons, quiz: null,
  today: () => '2026-10-06', now: () => new Date('2026-10-06T12:00:00'), refresh() {},
});
const byText = (root, tag, text) => root.all((e) => e.tag === tag && e.text.includes(text))[0];

function solve(root, q) {
  if (q.type === 'choice') root.all((e) => e.tag === 'button' && e.classes.has('choice'))[q.answer.index].click();
  else if (q.type === 'numeric') root.all((e) => e.tag === 'input')[0].value = String(q.answer.value);
  else {
    const fill = (row, account, amount) => { const [sel, amt] = row.all((e) => e.tag === 'select' || e.tag === 'input'); sel.value = account; amt.value = String(amount); };
    const adds = root.all((e) => e.tag === 'button' && e.text.includes('行を追加'));
    for (let k = 2; k < q.answer.debit.length; k++) adds[0].click();
    for (let k = 2; k < q.answer.credit.length; k++) adds[1].click();
    const rows = root.all((e) => e.classes.has('jrow'));
    const nD = Math.max(2, q.answer.debit.length);
    q.answer.debit.forEach((x, i) => fill(rows[i], x.account, x.amount));
    q.answer.credit.forEach((x, i) => fill(rows[nD + i], x.account, x.amount));
  }
  byText(root, 'button', '答え合わせ').click();
}

test('論点のページに講義へのリンクが出る（講義のない論点には出ない）', () => {
  const ctx = mkCtx();
  assert.ok(renderTopicDetail(ctx, 'c02').all((e) => e.tag === 'a' && e.attrs.href === '#/lesson/c02').length === 1);
  assert.equal(renderTopicDetail(ctx, 'c14').all((e) => e.tag === 'a' && e.attrs.href === '#/lesson/c14').length, 0);
});

test('講義ページ：節と仕訳例が出て、確認の問題を全部解くと「読んだ」が付き、ミニテストの回数には数えない', () => {
  const ctx = mkCtx();
  const page = renderLesson(ctx, 'c02');
  const text = page.text;
  for (const s of lessons.c02.sections) assert.ok(text.includes(s.heading), `${s.heading} が出ていない`);
  assert.ok(text.includes('未確認'));
  assert.equal(ctx.store.data.topicMarks.c02, undefined);

  byText(page, 'button', '確認の問題を解く').click();
  assert.equal(ctx.quiz.mode, 'lesson');
  assert.deepEqual(ctx.quiz.items.map((x) => x.q.id), lessons.c02.checkIds);

  const root = renderQuiz(ctx);
  assert.ok(root.text.includes('講義の確認'));
  for (let n = 0; n < lessons.c02.checkIds.length; n++) {
    const { q } = ctx.quiz.items[ctx.quiz.i];
    solve(root, q);
    assert.equal(ctx.quiz.shown.correct, true, `${q.id} の採点`);
    byText(root, 'button', n === lessons.c02.checkIds.length - 1 ? '結果を見る' : '次の問題へ').click();
  }
  assert.equal(ctx.quiz.phase, 'done');
  assert.ok(root.text.includes('講義の確認を終えました'));
  assert.ok(ctx.store.data.topicMarks.c02, '「読んだ」が付いていない');
  assert.equal(ctx.store.data.attempts.filter((a) => a.mode === 'lesson').length, 3);
  assert.equal(answeredToday(ctx.store.data, '2026-10-06').length, 0);
  assert.ok(renderLesson(ctx, 'c02').text.includes('読了'));
});

test('講義のない論点では、講義ページが「まだありません」と出る', () => {
  assert.ok(renderLesson(mkCtx(), 'c14').text.includes('まだありません'));
});
