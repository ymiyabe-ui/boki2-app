// 週末のページ：合格見込み点・総復習テスト・模試の記録・週次レポート
import { h, toast, fmtDate, field } from '../ui.js';
import { addDays, weekStartOf } from '../dates.js';
import { planWeekFor } from '../stats.js';
import { forecast, mockDiff, mockTotal } from '../forecast.js';
import { masteryAll } from '../mastery.js';
import { buildWeeklyReport } from '../report.js';
import { VERSION } from '../version.js';
import { forecastCard, weeklyResultCard } from './weekly-parts.js';
import { startWeekly } from './quiz.js';
import { saveFile } from './settings.js';

const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const signed = (x) => (x > 0 ? `+${fmt1(x)}` : x < 0 ? `−${fmt1(Math.abs(x))}` : '±0');

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボードが使えない環境：一時的な入力欄で選択してコピーする
    const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function renderWeekly(ctx) {
  const { store, config, plan } = ctx;
  const today = ctx.today();
  const ws = weekStartOf(today);
  const pw = planWeekFor(plan, today);
  const root = h('div', { class: 'view' }, h('h1', null, '週末の総復習'));
  if (store.message) root.append(h('div', { class: 'banner bad' }, store.message));

  root.append(forecastCard(ctx));

  // --- 総復習テスト ---
  const wr = config.weeklyReview;
  const nCur = Math.round(wr.total * wr.currentWeekRatio);
  const thisWeek = store.data.weeklyReviews.find((w) => w.weekStart === ws);
  root.append(h('div', { class: 'card' },
    h('h2', null, '総復習テスト'),
    h('p', null, `${wr.total}問（今週の論点${nCur}問＋過去の論点${wr.total - nCur}問。過去分は習熟度の低い論点を優先）。通しで時間を計ります。`),
    pw.status === 'in' ? h('p', { class: 'small muted' }, `今週：第${pw.week.week}週`) : null,
    thisWeek ? h('p', { class: 'small' }, `今週の結果：${thisWeek.correct}/${thisWeek.total}問（${fmtDate(thisWeek.date)}）。もう一度解くと置き換わります。`) : null,
    h('button', { class: 'primary', style: 'width:100%', onclick: () => {
      if (!ctx.questions.length) { toast('問題データを読み込めていません'); return; }
      if (!startWeekly(ctx)) { toast('出せる問題がありません'); return; }
      location.hash = '#/quiz';
    } }, thisWeek ? '総復習をやり直す' : '総復習を始める')));

  if (thisWeek) root.append(weeklyResultCard(ctx, thisWeek));

  root.append(mockCard(ctx));
  root.append(reportCard(ctx));
  return root;
}

function mockCard(ctx) {
  const { store, config, topics } = ctx;
  const today = ctx.today();
  const date = h('input', { type: 'date', value: today });
  const minutes = h('input', { type: 'text', inputMode: 'numeric', placeholder: '例：88（任意）' });
  const inputs = config.examSections.map((s) => h('input', { type: 'text', inputMode: 'decimal', placeholder: `0〜${s.points}`, 'aria-label': `第${s.q}問の得点` }));
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    const scores = {};
    config.examSections.forEach((s, i) => { scores[s.q] = inputs[i].value.trim() === '' ? NaN : Number(inputs[i].value.normalize('NFKC')); });
    const total = mockTotal(scores, config);
    if (total === null) { toast('各問の得点を、0から配点の範囲で入れてください'); return; }
    if (!date.value) { toast('日付を入れてください'); return; }
    const f = forecast(topics, masteryAll(topics, store.data, config, today), config);
    const min = Number(String(minutes.value).normalize('NFKC'));
    store.addMock({ date: date.value, scores, total, minutes: Number.isFinite(min) && min > 0 ? min : null, forecast: f });
    toast(`模試を記録しました（${total}点）`);
    ctx.refresh();
  } },
  h('h2', null, '模試の記録'),
  h('p', { class: 'small muted' }, '第1〜5問の得点を入れると、記録した時点の合格見込み点との差が出ます。'),
  field('受けた日', date),
  h('div', { class: 'jtable', style: 'grid-template-columns:repeat(2,1fr)' }, config.examSections.map((s, i) => field(`第${s.q}問（${s.points}点）`, inputs[i]))),
  field('かかった時間（分）', minutes),
  h('button', { class: 'primary', type: 'submit', style: 'width:100%' }, '記録する'));

  const card = h('div', { class: 'card' }, form);
  const mocks = [...store.data.mocks].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ts < b.ts ? 1 : -1));
  if (mocks.length) {
    card.append(h('h3', null, '記録した模試'), h('ul', { class: 'list' }, mocks.map((m) => {
      const d = mockDiff(m);
      return h('li', null,
        h('div', { class: 'body' },
          h('div', { class: 'title' }, `${fmtDate(m.date)}　${m.total}点${m.total >= config.passScore ? '（合格ライン）' : ''}`),
          h('div', { class: 'small muted' },
            config.examSections.map((s) => `第${s.q}問 ${m.scores[s.q]}`).join('／'),
            d.total === null ? '' : `　予測${fmt1(m.forecastTotal)}点との差 ${signed(d.total)}`),
          d.total === null ? null : h('div', { class: 'small muted' }, config.examSections.map((s) => `第${s.q}問 ${signed(d.bySection[s.q])}`).join('　'))),
        h('button', { class: 'small danger', onclick: () => { if (confirm('この模試の記録を削除しますか？')) { store.deleteMock(m.id); ctx.refresh(); } } }, '削除'));
    })));
  }
  return card;
}

function reportCard(ctx) {
  const { store, config, topics, plan, holidays } = ctx;
  const build = () => buildWeeklyReport({ data: store.data, topics, config, plan, holidays, today: ctx.today(), appVersion: VERSION, now: ctx.now() });
  const name = () => `boki2-weekly-${weekStartOf(ctx.today())}.json`;
  const preview = h('pre', { class: 'small', style: 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto' });
  const det = h('details', { ontoggle: () => { if (det.open) preview.textContent = JSON.stringify(build(), null, 2); } },
    h('summary', null, '中身を確認する'), preview);
  return h('div', { class: 'card' },
    h('h2', null, '週次レポート'),
    h('p', { class: 'small muted' }, `${fmtDate(weekStartOf(ctx.today()))}〜${fmtDate(addDays(weekStartOf(ctx.today()), 6))}の勉強時間・論点ごとの正答率とレベルの変化・間違えた問題・誤り報告・模試・来週の推奨をまとめます。PCの Claude Code に貼り付けて週次アップデートに使います。`),
    h('div', { class: 'row' },
      h('button', { class: 'primary grow', onclick: async () => {
        const ok = await copyText(JSON.stringify(build(), null, 2));
        toast(ok ? 'レポートをコピーしました。PCのClaude Codeに貼り付けてください' : 'コピーできませんでした。「ファイルに保存」を使ってください');
      } }, 'コピーする'),
      h('button', { class: 'grow', onclick: async () => {
        const r = await saveFile(JSON.stringify(build(), null, 2), name());
        if (r !== 'cancelled') toast(r === 'shared' ? 'レポートを保存しました' : `${name()} をダウンロードしました`);
      } }, 'ファイルに保存')),
    det,
    h('p', { class: 'hint' }, 'レポートには学習記録が含まれます。リポジトリには入れず、private/reviews/ に保存します。'));
}
