// 勉強時間の記録：タイマー（開始・停止）と手入力
import { h, field, selectEl, fmtClock, fmtMin, fmtDate, toast, uiPref } from '../ui.js';
import { SLOTS, SLOT_LABELS, KIND_LABELS, addDays, defaultSlot } from '../dates.js';
import { planWeekFor } from '../stats.js';
import { topicName } from './parts.js';

const slotOptions = SLOTS.map((s) => [s, SLOT_LABELS[s]]);
const kindOptions = Object.entries(KIND_LABELS);

function topicOptions(ctx) {
  return [['', '（論点なし）'], ...ctx.topics.map((t) => [t.id, `${t.id} ${t.name}`])];
}

/** 論点の初期値：直前に選んだもの → 今週の最初の論点 */
function defaultTopic(ctx) {
  const last = uiPref('lastTopic');
  if (last && ctx.topics.some((t) => t.id === last)) return last;
  const pw = planWeekFor(ctx.plan, ctx.today());
  return pw.week && pw.week.topics.length ? pw.week.topics[0] : '';
}

export function renderRecord(ctx) {
  const { store, holidays } = ctx;
  const today = ctx.today();
  const now = ctx.now();
  const root = h('div', { class: 'view' }, h('h1', null, '勉強時間の記録'));
  const slotNow = defaultSlot(today, now.getHours(), holidays);
  const topicDefault = defaultTopic(ctx);

  // --- タイマー ---
  const timerCard = h('div', { class: 'card' }, h('h2', null, 'タイマー'));
  let tick = null;
  if (store.data.timer) {
    const t = store.data.timer;
    const clock = h('div', { class: 'clock' }, fmtClock(store.timerElapsedMs()));
    tick = setInterval(() => { clock.textContent = fmtClock(store.timerElapsedMs()); }, 1000);
    timerCard.append(
      clock,
      h('p', { class: 'muted small', style: 'text-align:center' },
        `${SLOT_LABELS[t.slot]}・${KIND_LABELS[t.kind]}・${t.topicId ? topicName(ctx, t.topicId) : '論点なし'}（開始 ${new Date(t.startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）`),
      h('p', { class: 'small muted', style: 'text-align:center' }, 'アプリを閉じても、画面をロックしても、経過時間は開始時刻から計算されます。'),
      h('div', { class: 'row' },
        h('button', { class: 'primary grow', onclick: () => {
          const rec = store.stopTimer();
          uiPref('lastTopic', rec.topicId || '');
          toast(`${fmtMin(rec.minutes)}を記録しました`);
          ctx.refresh();
        } }, '停止して記録'),
        h('button', { class: 'danger', onclick: () => { if (confirm('このタイマーを記録せずに破棄しますか？')) { store.cancelTimer(); ctx.refresh(); } } }, '破棄')));
  } else {
    const slot = selectEl(slotOptions, slotNow);
    const kind = selectEl(kindOptions, 'input');
    const topic = selectEl(topicOptions(ctx), topicDefault);
    timerCard.append(
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('時間帯', slot)), h('div', { class: 'grow' }, field('内容', kind))),
      field('論点', topic),
      h('button', { class: 'primary', style: 'width:100%', onclick: () => {
        store.startTimer({ slot: slot.value, kind: kind.value, topicId: topic.value });
        ctx.refresh();
      } }, '▶ 開始'));
  }
  root.append(timerCard);

  // --- 手入力 ---
  const date = h('input', { type: 'date', value: today, max: today });
  const slot = selectEl(slotOptions, slotNow);
  const syncSlot = () => { slot.value = defaultSlot(date.value || today, now.getHours(), holidays); };
  date.addEventListener('change', syncSlot);
  const minutes = h('input', { type: 'number', inputMode: 'numeric', min: 1, max: 720, placeholder: '例：45' });
  const kind = selectEl(kindOptions, 'input');
  const topic = selectEl(topicOptions(ctx), topicDefault);
  const note = h('input', { type: 'text', placeholder: '任意（例：第3章の例題）', maxLength: 80 });
  const quick = [15, 30, 45, 60, 90].map((m) => h('button', { type: 'button', class: 'small', onclick: () => { minutes.value = m; } }, `${m}分`));
  root.append(h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const m = Number(minutes.value);
    if (!date.value || !Number.isFinite(m) || m < 1) { toast('日付と分数を入れてください'); return; }
    store.addSession({ date: date.value, slot: slot.value, minutes: m, topicId: topic.value, kind: kind.value, note: note.value.trim() });
    uiPref('lastTopic', topic.value);
    toast(`${fmtMin(m)}を記録しました`);
    ctx.refresh();
  } },
  h('h2', null, '手入力'),
  h('div', { class: 'row' }, h('div', { class: 'grow' }, field('日付', date)), h('div', { class: 'grow' }, field('時間帯', slot))),
  field('勉強した分数', minutes), h('div', { class: 'row' }, quick),
  h('div', { class: 'row' }, h('div', { class: 'grow' }, field('内容', kind))),
  field('論点', topic), field('メモ', note),
  h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:6px' }, '記録する')));

  // --- 最近の記録（直近14日）---
  const from = addDays(today, -13);
  const recent = store.data.sessions.filter((s) => s.date >= from).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  const list = h('div', { class: 'card' }, h('h2', null, '最近の記録（14日）'));
  if (!recent.length) list.append(h('p', { class: 'muted' }, 'まだ記録がありません。'));
  else {
    list.append(h('ul', { class: 'list' }, recent.map((s) => h('li', null,
      h('div', { class: 'body' },
        h('div', { class: 'title' }, `${fmtDate(s.date)} ${SLOT_LABELS[s.slot]}　${fmtMin(s.minutes)}`),
        h('div', { class: 'small muted' }, `${KIND_LABELS[s.kind] || s.kind}・${s.topicId ? topicName(ctx, s.topicId) : '論点なし'}${s.note ? `・${s.note}` : ''}`)),
      h('button', { class: 'small danger', 'aria-label': '削除', onclick: () => { if (confirm(`${fmtDate(s.date)}の${fmtMin(s.minutes)}を削除しますか？`)) { store.deleteSession(s.id); ctx.refresh(); } } }, '削除')))));
  }
  root.append(list);

  root._cleanup = () => { if (tick) clearInterval(tick); };
  return root;
}
