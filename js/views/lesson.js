// 講義ページ：論点ごとの要点を短い節で読み、最後の確認問題を解くと「テキストを読んだ」が付く
import { h } from '../ui.js';
import { yen } from '../grade.js';
import { startLessonCheck } from './quiz.js';

function journalBlock(b) {
  const side = (title, rows) => h('div', { class: 'jside' }, h('div', { class: 'small muted' }, title),
    rows.map(([account, amount]) => h('div', { class: 'jline' }, h('span', null, account), h('span', { class: 'num' }, yen(amount)))));
  return h('div', { class: 'card jexample' },
    b.title ? h('h3', { style: 'margin-top:0' }, b.title) : null,
    h('div', { class: 'jtable' }, side('借方', b.debit), side('貸方', b.credit)),
    b.note ? h('p', { class: 'small muted', style: 'margin-bottom:0' }, b.note) : null);
}

function block(b) {
  switch (b.t) {
    case 'list': return h('ul', { class: 'lesson-list' }, b.items.map((x) => h('li', null, x)));
    case 'tip': return h('div', { class: 'banner info lesson-tip' }, h('span', null, `⚠ ${b.text}`));
    case 'journal': return journalBlock(b);
    default: return h('p', { class: 'lesson-p' }, b.text);
  }
}

export function renderLesson(ctx, id) {
  const topic = ctx.topics.find((t) => t.id === id);
  const lesson = ctx.lessons && ctx.lessons[id];
  const root = h('div', { class: 'view' }, h('a', { href: `#/topic/${id}` }, '← 論点のページへ'));
  if (!topic || !lesson) {
    root.append(h('p', null, 'この論点の講義はまだありません。'));
    return root;
  }
  const marked = !!ctx.store.data.topicMarks[id];
  root.append(h('div', null, h('h1', null, `${topic.id} ${topic.name}`),
    h('div', { class: 'row' },
      h('span', { class: 'badge' }, `約${lesson.minutes}分`),
      lesson.verified ? null : h('span', { class: 'badge warn' }, '未確認'),
      marked ? h('span', { class: 'badge' }, '読了') : null)));
  root.append(h('p', { class: 'small muted' }, lesson.summary));
  for (const s of lesson.sections) {
    root.append(h('section', { class: 'lesson-section' }, h('h2', null, s.heading), s.blocks.map(block)));
  }
  root.append(h('div', { class: 'card' },
    h('h2', null, '確認の問題'),
    h('p', { class: 'small' }, `${lesson.checkIds.length}問で、読んだ内容を確かめます。終わると「テキストを読んだ」が付きます。`),
    h('button', { class: 'primary', style: 'width:100%', onclick: () => {
      if (startLessonCheck(ctx, lesson)) location.hash = '#/quiz';
    } }, '確認の問題を解く')));
  root.append(h('p', { class: 'small muted' }, '講義はAIが書いたオリジナルの文章です。「未確認」の間は、気になる点を問題の答え合わせから報告してください。'));
  return root;
}
