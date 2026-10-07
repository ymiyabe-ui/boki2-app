// 論点の一覧と詳細（「テキストを読んだ」チェック・習熟度の内訳）
import { h, fmtDate, fmtMin, toast } from '../ui.js';
import { LEVEL_NAMES, computeMastery, masteryAll, nextLevelHint, scoreMark } from '../mastery.js';
import { planWeekFor } from '../stats.js';
import { topicMap } from './parts.js';

const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function renderTopics(ctx) {
  const { store, config } = ctx;
  const today = ctx.today();
  const mastery = masteryAll(ctx.topics, store.data, config, today);
  const pw = planWeekFor(ctx.plan, today);
  const root = h('div', { class: 'view' }, h('h1', null, '論点'));
  root.append(h('div', { class: 'card' }, topicMap(ctx, mastery, pw.week ? pw.week.topics : [])));
  root.append(h('div', { class: 'card' }, h('h2', null, '一覧（学習順）'),
    h('ul', { class: 'list' }, ctx.topics.map((t) => {
      const m = mastery[t.id];
      return h('li', null,
        h('span', { class: `chip lv${m.level}`, style: 'min-height:36px;width:36px' }, h('span', { class: 'lv' }, String(m.level))),
        h('a', { class: 'body title', href: `#/topic/${t.id}` }, `${t.id} ${t.name}`),
        m.marked ? h('span', { class: 'badge' }, '読了') : null,
        m.stale ? h('span', { class: 'badge warn' }, '要復習') : null);
    }))));
  return root;
}

export function renderTopicDetail(ctx, id) {
  const { store, config } = ctx;
  const topic = ctx.topics.find((t) => t.id === id);
  const root = h('div', { class: 'view' }, h('a', { href: '#/topics' }, '← 論点一覧へ'));
  if (!topic) {
    root.append(h('p', null, '論点が見つかりません。'));
    return root;
  }
  const today = ctx.today();
  const m = computeMastery(id, store.data, config, today);

  root.append(h('div', null, h('h1', null, `${topic.id} ${topic.name}`),
    h('div', { class: 'small muted' }, `主な出題：第${topic.examQ.join('・')}問`)));
  if (topic.includes && topic.includes.length) root.append(h('p', { class: 'small' }, `含む項目：${topic.includes.join('、')}`));
  if (topic.scopeNote) root.append(h('p', { class: 'small muted' }, `範囲の注意：${topic.scopeNote}`));

  const check = h('input', { type: 'checkbox', checked: m.marked, onchange: (e) => {
    store.setTopicRead(id, e.target.checked);
    toast(e.target.checked ? '「読んだ」にしました' : 'チェックを外しました');
    ctx.refresh();
  } });
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('span', { class: `chip lv${m.level}`, style: 'width:56px;min-height:56px' }, h('span', { class: 'lv' }, String(m.level))),
      h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, `レベル${m.level}　${LEVEL_NAMES[m.level]}`),
        m.stale ? h('span', { class: 'badge warn' }, `要復習（${m.daysSince}日ぶり）`) : null)),
    h('p', { class: 'small muted' }, nextLevelHint(m.level, config)),
    h('label', { class: 'check' }, check, h('span', null, 'テキストを読んだ')),
    h('ul', { class: 'small muted', style: 'margin:6px 0 0;padding-left:1.2em' },
      h('li', null, `直近${m.n}問の正答率：${pct(m.rate)}（○=1・△=0.5・×=0）`),
      h('li', null, `そのうち目安時間内：${pct(m.inTimeRatio)}`),
      h('li', null, `7日以上あけた再挑戦で○：${m.spaced ? 'あり' : 'なし'}`),
      h('li', null, `最後に触れた日：${m.lastTouched ? fmtDate(m.lastTouched) : '—'}`))));

  const minutes = store.data.sessions.filter((s) => s.topicId === id).reduce((a, s) => a + s.minutes, 0);
  root.append(h('p', { class: 'small muted' }, `この論点に使った時間：${fmtMin(minutes)}（レベルには影響しません）`));

  const attempts = store.data.attempts.filter((a) => a.topicId === id).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 10);
  const card = h('div', { class: 'card' }, h('h2', null, '直近の解答'));
  if (!attempts.length) card.append(h('p', { class: 'muted' }, 'まだ解答の記録がありません。'));
  else {
    card.append(h('ul', { class: 'list' }, attempts.map((a) => h('li', null,
      h('span', { class: 'mark' }, scoreMark(a.score)),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, a.ref ? [a.ref.book, a.ref.page && `p.${a.ref.page}`, a.ref.no && `No.${a.ref.no}`].filter(Boolean).join(' ') : a.questionId),
        h('div', { class: 'small muted' }, `${fmtDate(a.date)}${a.inTime === false ? '・時間超過' : ''}`))))));
  }
  root.append(card);
  return root;
}
