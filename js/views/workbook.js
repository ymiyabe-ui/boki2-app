// 問題集ログ：書名・ページ・問題番号と結果（○△×）だけを記録する。問題文や解説は書かない
import { h, field, selectEl, fmtDate, toast, uiPref } from '../ui.js';
import { retryList, scoreMark } from '../mastery.js';
import { planWeekFor } from '../stats.js';
import { topicName } from './parts.js';

const refText = (ref) => [ref.book, ref.page ? `p.${ref.page}` : '', ref.no ? `No.${ref.no}` : ''].filter(Boolean).join(' ');

export function renderWorkbook(ctx) {
  const { store, config } = ctx;
  const root = h('div', { class: 'view' }, h('h1', null, '問題集ログ'));

  // 書名の候補：設定の books ＋ これまでに使った書名
  const used = [...new Set([...(config.books || []), ...store.data.attempts.filter((a) => a.ref && a.ref.book).map((a) => a.ref.book)])];
  const pw = planWeekFor(ctx.plan, ctx.today());
  const topicDefault = uiPref('lastWbTopic') || (pw.week && pw.week.topics[0]) || '';

  const book = h('input', { type: 'text', list: 'book-list', value: uiPref('lastBook') || '', placeholder: '例：○○問題集', autocomplete: 'off' });
  const page = h('input', { type: 'text', inputMode: 'text', placeholder: '例：45' });
  const no = h('input', { type: 'text', inputMode: 'text', placeholder: '例：3-2' });
  const topic = selectEl([['', '選んでください'], ...ctx.topics.map((t) => [t.id, `${t.id} ${t.name}`])], topicDefault);
  const inTime = h('input', { type: 'checkbox', checked: true });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '結果' },
    [['o', '○', 1], ['triangle', '△', 0.5], ['x', '×', 0]].map(([v, label]) =>
      h('label', null, h('input', { type: 'radio', name: 'result', value: v }), label)));

  const fill = (item) => {
    book.value = item.ref.book || '';
    page.value = item.ref.page || '';
    no.value = item.ref.no || '';
    topic.value = item.topicId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('再挑戦の内容を入れました。結果を選んで記録してください');
  };

  root.append(h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const picked = seg.querySelector('input:checked');
    const ref = { book: book.value.trim(), page: page.value.trim(), no: no.value.trim() };
    if (!ref.book || (!ref.page && !ref.no)) { toast('書名と、ページか問題番号を入れてください'); return; }
    if (!topic.value) { toast('論点を選んでください'); return; }
    if (!picked) { toast('結果（○△×）を選んでください'); return; }
    store.addAttempt({ topicId: topic.value, score: config.workbookScore[picked.value], inTime: inTime.checked, ref, mode: 'workbook' });
    uiPref('lastBook', ref.book);
    uiPref('lastWbTopic', topic.value);
    toast(`${scoreMark(config.workbookScore[picked.value])} を記録しました`);
    ctx.refresh();
  } },
  h('h2', null, '解いた問題を記録'),
  field('書名', book), h('datalist', { id: 'book-list' }, used.map((b) => h('option', { value: b }))),
  h('div', { class: 'row' }, h('div', { class: 'grow' }, field('ページ', page)), h('div', { class: 'grow' }, field('問題番号', no))),
  field('論点', topic),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, '結果（△＝一部できた・惜しい）'), seg),
  h('label', { class: 'check' }, inTime, h('span', null, '目安時間内に解けた')),
  h('p', { class: 'hint' }, '△と×は下の「再挑戦リスト」に入ります。同じ書名・ページ・番号で後から○を付けると、リストから外れます。'),
  h('button', { class: 'primary', type: 'submit', style: 'width:100%' }, '記録する')));

  // --- 再挑戦リスト ---
  const retry = retryList(store.data.attempts.filter((a) => a.mode === 'workbook'));
  const retryCard = h('div', { class: 'card' }, h('h2', null, `再挑戦リスト（${retry.length}）`));
  if (!retry.length) retryCard.append(h('p', { class: 'muted' }, '△・×の問題はありません。'));
  else {
    retryCard.append(h('ul', { class: 'list' }, retry.map((r) => h('li', null,
      h('span', { class: 'mark' }, scoreMark(r.score)),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, refText(r.ref)),
        h('div', { class: 'small muted' }, `${topicName(ctx, r.topicId)}・最後に解いたのは${fmtDate(r.date)}${r.tries > 1 ? `・${r.tries}回目まで` : ''}`)),
      h('button', { class: 'small', onclick: () => fill(r) }, '再挑戦')))));
  }
  root.append(retryCard);

  // --- 最近の記録 ---
  const recent = store.data.attempts.filter((a) => a.mode === 'workbook').sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 15);
  const recentCard = h('div', { class: 'card' }, h('h2', null, '最近の記録'));
  if (!recent.length) recentCard.append(h('p', { class: 'muted' }, 'まだ記録がありません。'));
  else {
    recentCard.append(h('ul', { class: 'list' }, recent.map((a) => h('li', null,
      h('span', { class: 'mark' }, scoreMark(a.score)),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, refText(a.ref)),
        h('div', { class: 'small muted' }, `${fmtDate(a.date)}・${topicName(ctx, a.topicId)}${a.inTime === false ? '・時間超過' : ''}`)),
      h('button', { class: 'small danger', 'aria-label': '削除', onclick: () => { if (confirm('この記録を削除しますか？')) { store.deleteAttempt(a.id); ctx.refresh(); } } }, '削除')))));
  }
  root.append(recentCard);
  return root;
}
