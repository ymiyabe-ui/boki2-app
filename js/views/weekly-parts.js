// 週末の画面の部品：合格見込み点・総復習の結果
import { h, fmtMin } from '../ui.js';
import { forecast } from '../forecast.js';
import { masteryAll } from '../mastery.js';
import { levelChanges } from '../weekly.js';
import { progressBar } from '../ui.js';
import { topicName } from './parts.js';

const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pct = (x) => `${Math.round(x * 100)}%`;
const sign = (x) => (x > 0 ? `+${fmt1(x)}` : x < 0 ? `−${fmt1(Math.abs(x))}` : '±0');

/** 合格見込み点（第1〜5問の内訳つき）。期待正答率は仮置きなので、模試と比べて見直す */
export function forecastCard(ctx) {
  const { store, config, topics } = ctx;
  const mastery = masteryAll(topics, store.data, config, ctx.today());
  const f = forecast(topics, mastery, config);
  const pass = config.passScore;
  return h('div', { class: 'card' },
    h('h2', null, '合格見込み点'),
    h('div', { class: 'stat' },
      h('span', { class: 'big' }, `${fmt1(f.total)}点`),
      h('span', { class: 'muted' }, `/ 100点（合格 ${pass}点）`),
      h('span', { class: f.total >= pass ? '' : 'muted', style: f.total >= pass ? 'color:var(--good);font-weight:600' : '' }, `（${sign(f.total - pass)}）`)),
    progressBar(f.total / 100),
    h('div', { class: 'slots' }, f.sections.map((s) => h('div', { class: 'slot-row' },
      h('span', null, `第${s.q}問`),
      progressBar(s.rate),
      h('span', { class: 'nums' }, `${fmt1(s.score)} / ${s.points}点`)))),
    h('p', { class: 'hint' }, '論点のレベルから出した目安です（期待正答率はレベル0〜4で0・20・50・75・90%の仮置き）。模試を記録すると、予測との差が出ます。'));
}

const arrow = (before, after) => (after > before ? `↑ ${before}→${after}` : after < before ? `↓ ${before}→${after}` : `→ ${after}`);

/** 総復習の結果：正答率・時間・論点ごとの変化・来週の推奨 */
export function weeklyResultCard(ctx, review) {
  const { store, config, topics } = ctx;
  const changes = levelChanges(topics, store.data, config, review.weekStart, ctx.today());
  const rows = Object.entries(review.topics).sort(([a], [b]) => (a < b ? -1 : 1));
  const node = h('div', { class: 'view' });
  node.append(h('div', { class: 'card' },
    h('h2', null, '総復習の結果'),
    h('p', { class: 'big-ans' }, `${review.correct} / ${review.total} 問正解（${pct(review.rate)}）`),
    h('p', { class: 'small muted' }, `かかった時間：${fmtMin(Math.round(review.sec / 60))}（${review.sec}秒）`)));

  node.append(h('div', { class: 'card' }, h('h2', null, '論点ごとの変化'),
    h('ul', { class: 'list' }, rows.map(([id, r]) => {
      const c = changes[id];
      const prev = r.prevRate == null ? '' : `（前回の総復習 ${pct(r.prevRate)}）`;
      return h('li', null,
        h('span', { class: `chip lv${c.after}`, style: 'min-height:36px;width:36px' }, h('span', { class: 'lv' }, String(c.after))),
        h('div', { class: 'body' },
          h('div', { class: 'title' }, topicName(ctx, id)),
          h('div', { class: 'small muted' }, `${r.correct}/${r.n}問・${pct(r.rate)}${prev}　レベル ${arrow(c.before, c.after)}（週の初め→今）`)),
        r.rate < config.weeklyDecision.redoBelow ? h('span', { class: 'badge warn' }, 'やり直し') : r.rate >= config.weeklyDecision.advanceAbove ? h('span', { class: 'badge' }, '90%超') : null);
    }))));

  const rec = review.recommend;
  const list = (ids) => h('ul', { class: 'small', style: 'margin:4px 0;padding-left:1.2em' }, ids.map((id) => h('li', null, topicName(ctx, id))));
  node.append(h('div', { class: 'card' }, h('h2', null, '来週の推奨'),
    rec.redo.length ? [h('p', { style: 'margin-bottom:0' }, `やり直し（正答率${pct(config.weeklyDecision.redoBelow)}未満）：来週の頭に入れる`), list(rec.redo)] : h('p', { class: 'muted' }, `正答率${pct(config.weeklyDecision.redoBelow)}未満の論点はありません。`),
    rec.strong.length
      ? [h('p', { style: 'margin-bottom:0' }, `${pct(config.weeklyDecision.advanceAbove)}以上の論点：${rec.strong.map((id) => id).join('・')}`),
        rec.advance.length ? [h('p', { style: 'margin:4px 0 0' }, '前倒しの候補（次の論点）'), list(rec.advance)] : h('p', { class: 'muted' }, '前倒しできる次の論点はありません。')]
      : h('p', { class: 'muted' }, `${pct(config.weeklyDecision.advanceAbove)}以上の論点はまだありません。`)));
  return node;
}
