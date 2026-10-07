// 複数の画面で使う部品
import { h } from '../ui.js';
import { LEVEL_NAMES } from '../mastery.js';

/** 論点マップ（レベルで色分け。色だけに頼らず、数字と「要」の印も付ける） */
export function topicMap(ctx, mastery, thisWeekIds = []) {
  const group = (area, title) =>
    h('div', null,
      h('div', { class: 'map-title' }, title),
      h('div', { class: 'map' },
        ctx.topics.filter((t) => t.area === area).map((t) => {
          const m = mastery[t.id];
          return h('a', {
            class: `chip lv${m.level}${m.stale ? ' stale' : ''}${thisWeekIds.includes(t.id) ? ' now' : ''}`,
            href: `#/topic/${t.id}`,
            'aria-label': `${t.id} ${t.name} レベル${m.level}${m.stale ? ' 要復習' : ''}`,
          }, h('span', { class: 'id' }, t.id), h('span', { class: 'lv' }, String(m.level)));
        })));
  return h('div', null,
    group('shogyo', '商業簿記'),
    group('kogyo', '工業簿記'),
    h('div', { class: 'legend' },
      LEVEL_NAMES.map((n, i) => h('span', null, h('i', { class: `lv${i}` }), `${i} ${n}`)),
      h('span', null, h('i', { style: 'border:2px dashed var(--bad)' }), '要＝14日以上触れていない')));
}

export const topicName = (ctx, id) => {
  const t = ctx.topics.find((x) => x.id === id);
  return t ? `${t.id} ${t.name}` : id || '（論点なし）';
};
