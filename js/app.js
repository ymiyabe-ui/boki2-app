// 起動・画面の切り替え・Service Worker の登録と更新通知
import { createStore } from './store.js';
import { toYmd } from './dates.js';
import { h } from './ui.js';
import { renderHome } from './views/home.js';
import { renderRecord } from './views/record.js';
import { renderWorkbook } from './views/workbook.js';
import { renderQuiz } from './views/quiz.js';
import { renderWeekly } from './views/weekly.js';
import { renderTopics, renderTopicDetail } from './views/topics.js';
import { renderLesson } from './views/lesson.js';
import { renderSettings } from './views/settings.js';

const TABS = [
  ['#/', 'ホーム', '🏠'],
  ['#/record', '時間', '⏱'],
  ['#/quiz', 'テスト', '✏️'],
  ['#/workbook', '問題集', '📝'],
  ['#/topics', '論点', '🗺'],
  ['#/settings', '設定', '⚙'],
];

const getJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めません（${res.status}）`);
  return res.json();
};

/** 保存先が使えない環境でも画面は動くよう、メモリ上の代替を用意する（その場合は警告を出す） */
function pickStorage() {
  try {
    const k = 'boki2-app:probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return { storage: localStorage, ok: true };
  } catch {
    const m = new Map();
    return { ok: false, storage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } };
  }
}

async function main() {
  const appEl = document.getElementById('app');
  let topics, config, plan, holidays;
  try {
    [{ topics }, config, plan, { dates: holidays }] = await Promise.all([
      getJson('./data/topics.json'), getJson('./data/config.json'), getJson('./data/plan.json'), getJson('./data/holidays.json'),
    ]);
  } catch (e) {
    appEl.replaceChildren(h('div', { class: 'banner bad' }, `データを読み込めませんでした：${e.message}。電波の良い場所で開き直してください。`));
    return;
  }

  // 問題データ。読み込めなくても他の画面は使えるよう、失敗しても止めない
  let questions = [];
  let lessons = {};
  try {
    const { files } = await getJson('./data/questions/index.json');
    const bodies = await Promise.all(files.map((f) => getJson(`./data/questions/${f}`)));
    questions = bodies.flatMap((b) => b.questions);
  } catch (e) {
    console.warn('問題データを読み込めませんでした', e);
  }

  // 講義データ。論点ごとに1ファイル。読み込めなくても他の画面は使える
  try {
    const { files } = await getJson('./data/lessons/index.json');
    const bodies = await Promise.all(files.map((f) => getJson(`./data/lessons/${f}`)));
    lessons = Object.fromEntries(bodies.map((b) => [b.topicId, b]));
  } catch (e) {
    console.warn('講義データを読み込めませんでした', e);
  }

  const { storage, ok } = pickStorage();
  const store = createStore(storage).load();
  if (!ok) store.message = 'この端末では記録を保存できません（プライベートブラウズなど）。通常のタブで開いてください。';
  // 端末内のデータが自動で消されにくくなるよう、永続化を依頼する（対応していない環境では何も起きない）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const ctx = {
    store, topics, config, plan, holidays, questions, lessons, quiz: null,
    now: () => new Date(),
    today: () => toYmd(new Date()),
    refresh: () => render(),
  };

  const tabs = h('nav', { class: 'tabs', 'aria-label': 'メニュー' }, TABS.map(([href, label, ico]) => h('a', { href, 'data-href': href }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label)));
  document.body.append(tabs);
  let cleanup = null;

  function route() {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/topic\/([a-z0-9]+)$/);
    if (m) return { tab: '#/topics', view: () => renderTopicDetail(ctx, m[1]) };
    const lm = hash.match(/^#\/lesson\/([a-z0-9]+)$/);
    if (lm) return { tab: '#/topics', view: () => renderLesson(ctx, lm[1]) };
    switch (hash) {
      case '#/record': return { tab: hash, view: () => renderRecord(ctx) };
      case '#/weekly': return { tab: '#/quiz', view: () => renderWeekly(ctx) };
      case '#/quiz': return { tab: hash, view: () => renderQuiz(ctx) };
      case '#/workbook': return { tab: hash, view: () => renderWorkbook(ctx) };
      case '#/topics': return { tab: hash, view: () => renderTopics(ctx) };
      case '#/settings': return { tab: hash, view: () => renderSettings(ctx) };
      default: return { tab: '#/', view: () => renderHome(ctx) };
    }
  }

  function render() {
    if (cleanup) cleanup();
    const { tab, view } = route();
    let node;
    try {
      node = view();
    } catch (e) {
      console.error(e);
      node = h('div', { class: 'banner bad' }, `画面の表示でエラーが起きました：${e.message}`);
    }
    cleanup = node._cleanup || null;
    const y = window.scrollY;
    appEl.replaceChildren(node);
    window.scrollTo(0, y);
    tabs.querySelectorAll('a').forEach((a) => (a.dataset.href === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  // 日をまたいで開きっぱなしでも、アプリに戻ったときに今日の表示へ直す
  let shownDay = ctx.today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ctx.today() !== shownDay) { shownDay = ctx.today(); render(); }
    if (swReg) swReg.update().catch(() => {});
  });
  render();

  // --- Service Worker と更新通知 ---
  let swReg = null;
  if ('serviceWorker' in navigator) {
    const showUpdate = (worker) => {
      if (document.getElementById('update-banner')) return;
      document.body.prepend(h('div', { id: 'update-banner', class: 'banner info', style: 'position:sticky;top:0;z-index:30;border-radius:0;justify-content:center' },
        h('span', null, '新しいバージョンがあります'),
        h('button', { class: 'small primary', onclick: () => worker.postMessage({ type: 'SKIP_WAITING' }) }, '再読み込み')));
    };
    let reloading = false;
    // 初回インストール時にも controllerchange は起きるので、すでに版が入っていた場合（＝更新）だけ再読み込みする
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
        });
      });
    }).catch((e) => console.warn('Service Worker を登録できませんでした', e));
  }
}

main();
