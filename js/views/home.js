// ホーム：今週の論点・時間と目標の差・累計と計画線・論点マップ・要復習
import { h, fmtHours, fmtMin, fmtDate, fmtClock, progressBar } from '../ui.js';
import { SLOTS, SLOT_LABELS, addDays, dayTargets, diffDays, sumSlots, weekStartOf, dayType } from '../dates.js';
import { cumulativeSeries, minutesOnDate, planWeekFor, weekSummary } from '../stats.js';
import { masteryAll } from '../mastery.js';
import { backupDueDays } from '../store.js';
import { topicMap, topicName } from './parts.js';
import { answeredToday, dueCount } from './quiz.js';
import { forecast } from '../forecast.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
};

/** 累計の折れ線（点線＝計画、実線＝実績） */
function chart(series) {
  const W = 320, H = 150, L = 34, R = 8, T = 8, B = 22;
  const maxMin = Math.max(...series.map((p) => p.plan), ...series.map((p) => p.actual || 0), 60);
  const maxH = Math.ceil(maxMin / 60 / 10) * 10;
  const x = (i) => L + (i / Math.max(1, series.length - 1)) * (W - L - R);
  const y = (min) => T + (1 - min / 60 / maxH) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '累計の勉強時間と計画線のグラフ' });
  for (let g = 0; g <= 2; g++) {
    const val = (maxH / 2) * g;
    svg.append(s('line', { class: 'grid', x1: L, x2: W - R, y1: y(val * 60), y2: y(val * 60) }));
    const t = s('text', { x: L - 4, y: y(val * 60) + 3, 'text-anchor': 'end' });
    t.textContent = `${val}h`;
    svg.append(t);
  }
  const poly = (cls, pts) => s('polyline', { class: cls, points: pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') });
  svg.append(poly('plan', series.map((p, i) => [i, p.plan])));
  const done = series.map((p, i) => [i, p.actual]).filter(([, v]) => v !== null);
  if (done.length) svg.append(poly('actual', done));
  for (const [i, anchor] of [[0, 'start'], [series.length - 1, 'end']]) {
    const t = s('text', { x: x(i), y: H - 6, 'text-anchor': anchor });
    const [, m, d] = series[i].date.split('-').map(Number);
    t.textContent = `${m}/${d}`;
    svg.append(t);
  }
  return svg;
}

export function renderHome(ctx) {
  const { store, config, plan, holidays } = ctx;
  const data = store.data;
  const today = ctx.today();
  const mastery = masteryAll(ctx.topics, data, config, today);
  const pw = planWeekFor(plan, today);
  const weekIds = pw.week ? pw.week.topics : [];
  const ws = weekStartOf(today);
  const week = weekSummary(data.sessions, config, holidays, ws);
  const root = h('div', { class: 'view' });

  // --- 通知 ---
  if (store.message) root.append(h('div', { class: 'banner bad' }, store.message));
  const due = backupDueDays(data, today);
  if (due !== null) {
    root.append(h('div', { class: 'banner' },
      h('span', null, due === Infinity ? 'まだバックアップを取っていません。' : `最後のバックアップから${due}日たちました。`),
      h('a', { class: 'btn small primary', href: '#/settings' }, 'バックアップする')));
  }
  if (data.timer) {
    root.append(h('a', { class: 'banner info', href: '#/record', style: 'text-decoration:none;color:inherit' },
      h('span', null, `⏱ タイマー作動中（${SLOT_LABELS[data.timer.slot]}）`), h('span', { class: 'timer-text', 'data-since': data.timer.startedAt }, fmtClock(store.timerElapsedMs()))));
  }

  // --- 見出し ---
  const daysToExam = diffDays(today, config.examDate);
  root.append(h('div', { class: 'head' },
    h('h1', null, '簿記2級'),
    h('span', { class: 'sub' }, daysToExam >= 0 ? `受験予定（${fmtDate(config.examDate)}）まであと${daysToExam}日` : '受験予定日を過ぎています')));

  // --- 今日のミニテスト ---
  if (ctx.questions.length) {
    const due = dueCount(ctx);
    const doneToday = answeredToday(data, today).length;
    root.append(h('a', { class: 'card', href: '#/quiz', style: 'text-decoration:none;color:inherit;display:block' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, '✏️ 今日のミニテスト'),
          h('span', { class: 'small muted' }, `再出題 ${due}問／今日解いた ${doneToday}問`)),
        h('span', { class: 'btn small primary' }, doneToday ? 'もう1セット' : '始める'))));
  }

  // --- 週末の総復習・合格見込み点 ---
  const fc = forecast(ctx.topics, mastery, config);
  root.append(h('a', { class: 'card', href: '#/weekly', style: 'text-decoration:none;color:inherit;display:block' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, '📊 週末の総復習'),
        h('span', { class: 'small muted' }, `合格見込み ${(Math.round(fc.total * 10) / 10).toFixed(1)}点／合格${config.passScore}点・週次レポート`)),
      h('span', { class: 'btn small' }, '開く'))));

  // --- 今週の論点 ---
  const weekCard = h('div', { class: 'card' });
  if (pw.status === 'in') {
    weekCard.append(h('h2', null, `今週の論点（第${pw.week.week}週／全${plan.weeks.length}週）`));
    if (weekIds.length) {
      weekCard.append(h('ul', { class: 'list' }, weekIds.map((id) => h('li', null,
        h('span', { class: `chip lv${mastery[id].level}`, style: 'min-height:36px;width:36px' }, h('span', { class: 'lv' }, String(mastery[id].level))),
        h('a', { class: 'body title', href: `#/topic/${id}` }, topicName(ctx, id)),
        mastery[id].marked ? h('span', { class: 'badge' }, '読了') : null))));
    } else {
      weekCard.append(h('p', { class: 'muted' }, '演習期です。新しい論点はありません。下の論点マップでレベルの低いところを優先しましょう。'));
    }
    if (pw.week.note) weekCard.append(h('p', { class: 'small muted' }, pw.week.note));
  } else if (pw.status === 'before') {
    weekCard.append(h('h2', null, '学習開始前'), h('p', { class: 'muted' }, `${fmtDate(plan.weeks[0].start)}の週から始まります。`));
  } else {
    weekCard.append(h('h2', null, '学習計画の期間が終わりました'), h('p', { class: 'muted' }, '論点マップで弱いところの復習を続けましょう。'));
  }
  root.append(weekCard);

  // --- 今週の勉強時間 ---
  const diff = week.totalActual - week.totalTarget;
  const todayT = dayTargets(today, config, holidays);
  const todayA = minutesOnDate(data.sessions, today);
  const timeCard = h('div', { class: 'card' },
    h('h2', null, `今週の勉強時間（${fmtDate(ws)}〜）`),
    h('div', { class: 'stat' },
      h('span', { class: 'big' }, fmtHours(week.totalActual)),
      h('span', { class: 'muted' }, `/ 目標 ${fmtHours(week.totalTarget)}`),
      h('span', { class: diff >= 0 ? '' : 'muted', style: diff >= 0 ? 'color:var(--good);font-weight:600' : '' },
        `（${diff >= 0 ? '+' : '−'}${fmtHours(Math.abs(diff))}）`)),
    progressBar(week.totalTarget ? week.totalActual / week.totalTarget : 0),
    h('div', { class: 'slots' },
      SLOTS.filter((sl) => week.target[sl] > 0 || week.actual[sl] > 0).map((sl) =>
        h('div', { class: 'slot-row' },
          h('span', null, SLOT_LABELS[sl]),
          progressBar(week.target[sl] ? week.actual[sl] / week.target[sl] : 1),
          h('span', { class: 'nums' }, `${fmtHours(week.actual[sl])} / ${fmtHours(week.target[sl])}`)))),
    h('p', { class: 'small muted' },
      `今日（${dayType(today, holidays) === 'holiday' ? '休日' : '平日'}）：`,
      SLOTS.filter((sl) => todayT[sl] > 0 || todayA[sl] > 0).map((sl) => `${SLOT_LABELS[sl]} ${fmtMin(todayA[sl])}/${fmtMin(todayT[sl])}`).join('　')));
  root.append(timeCard);

  // --- 累計と計画線 ---
  const series = cumulativeSeries(data.sessions, config, holidays, config.studyStart, config.examDate, today);
  const todayPt = series.filter((p) => p.actual !== null).at(-1);
  const cum = h('div', { class: 'card' }, h('h2', null, '累計の勉強時間と計画線'));
  if (todayPt) {
    const d = todayPt.actual - todayPt.plan;
    cum.append(h('div', { class: 'stat' },
      h('span', { class: 'big' }, fmtHours(todayPt.actual)),
      h('span', { class: 'muted' }, `/ 今日までの計画 ${fmtHours(todayPt.plan)}（${d >= 0 ? '+' : '−'}${fmtHours(Math.abs(d))}）`)));
  } else {
    cum.append(h('p', { class: 'muted' }, '学習開始前です。'));
  }
  cum.append(chart(series), h('p', { class: 'small muted' }, `点線＝計画（受験日までの総計 ${fmtHours(series.at(-1).plan)}）／ 実線＝実績`));
  root.append(cum);

  // --- 論点マップ ---
  root.append(h('div', { class: 'card' }, h('h2', null, '論点マップ'), topicMap(ctx, mastery, weekIds)));

  // --- 要復習 ---
  const stale = Object.values(mastery).filter((m) => m.stale).sort((a, b) => b.daysSince - a.daysSince);
  root.append(h('div', { class: 'card' }, h('h2', null, '要復習'),
    stale.length
      ? h('ul', { class: 'list' }, stale.map((m) => h('li', null,
        h('a', { class: 'body title', href: `#/topic/${m.topicId}` }, topicName(ctx, m.topicId)),
        h('span', { class: 'badge warn' }, `${m.daysSince}日ぶり`))))
      : h('p', { class: 'muted' }, '14日以上触れていない論点はありません。')));

  // --- タイマー表示の更新（画面を離れたら止める）---
  const tick = setInterval(() => {
    root.querySelectorAll('.timer-text').forEach((el) => { el.textContent = fmtClock(store.timerElapsedMs()); });
  }, 1000);
  root._cleanup = () => clearInterval(tick);
  return root;
}
