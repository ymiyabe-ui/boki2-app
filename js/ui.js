// 画面の共通部品。ユーザー入力は textContent 経由で入れ、innerHTML は使わない
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'for') el.htmlFor = v;
    else if (k === 'value') value = v; // select は子要素を入れてから設定する
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'list' || k === 'role' || k.startsWith('aria-') || k.startsWith('data-')) el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function fmtHours(min) {
  return `${(Math.round(min / 6) / 10).toFixed(1)}h`;
}

export function fmtMin(min) {
  const m = Math.round(min);
  const hh = Math.floor(m / 60);
  const r = m % 60;
  if (hh === 0) return `${r}分`;
  if (r === 0) return `${hh}時間`;
  return `${hh}時間${r}分`;
}

export function fmtDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  const dow = '日月火水木金土'[new Date(`${ymd}T00:00:00`).getDay()];
  return `${m}/${d}（${dow}）`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** 画面の見た目だけの記憶（直前に選んだ書名など）。記録データとは別に、使えなければ黙って無視する */
export function uiPref(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem('boki2-app:ui') || '{}');
    if (value === undefined) return all[key];
    all[key] = value;
    localStorage.setItem('boki2-app:ui', JSON.stringify(all));
  } catch {
    return undefined;
  }
}

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function selectEl(options, value, props = {}) {
  return h('select', { ...props, value }, options.map(([v, label]) => h('option', { value: v }, label)));
}

export function progressBar(ratio) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'fill', style: `width:${pct}%` }));
}
