// 設定：バックアップの書き出し・読み込み、バージョン、アプリの更新確認
import { h, toast, fmtDate } from '../ui.js';
import { toYmd } from '../dates.js';
import { VERSION } from '../version.js';

export async function saveFile(text, name) {
  const file = new File([text], name, { type: 'application/json' });
  // iPhone：共有シートから「ファイルに保存」へ。使えない環境ではダウンロードにする
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

const fmtSyncTime = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 端末間の同期の設定。サーバーのURLと合言葉は、この端末の中にだけ保存する（バックアップには入らない） */
export function syncCard(ctx) {
  const sync = ctx.sync;
  const card = h('div', { class: 'card' }, h('h2', null, '端末間の同期'));
  if (!sync) {
    card.append(h('p', { class: 'small muted' }, 'この環境では使えません（記録を保存できない環境です）。'));
    return card;
  }
  const st = sync.status();
  if (st.configured) {
    card.append(
      h('p', { class: 'small muted' }, 'PCとスマホの記録を、自動でまとめます。アプリを開いたときと、記録したあとに同期します。'),
      h('p', null, st.lastSyncAt ? `最後の同期：${fmtSyncTime(st.lastSyncAt)}` : 'まだ同期していません'),
      st.lastError ? h('div', { class: 'banner bad' }, st.lastError) : null,
      h('button', { class: 'primary', style: 'width:100%', onclick: async () => {
        const r = await sync.syncNow('manual');
        toast(r.ok ? (r.changed ? '同期しました（記録が更新されました）' : '同期しました') : (r.error || '同期できませんでした'));
        ctx.refresh();
      } }, '今すぐ同期'),
      h('button', { style: 'width:100%;margin-top:8px', onclick: () => {
        if (!confirm('この端末の同期をやめます。記録はこの端末に残ります（サーバーの記録も消えません）。よろしいですか？')) return;
        sync.clear();
        toast('同期をやめました');
        ctx.refresh();
      } }, '同期をやめる'));
    return card;
  }
  const url = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off' });
  const token = h('input', { type: 'password', placeholder: '合言葉', autocomplete: 'off' });
  card.append(
    h('p', { class: 'small muted' }, 'PCとスマホで、同じ記録を使えるようにします。設定用のリンクを開くと、下の欄は自動で入ります。'),
    h('label', { class: 'small' }, '同期先のURL'), url,
    h('label', { class: 'small' }, '合言葉'), token,
    h('button', { class: 'primary', style: 'width:100%;margin-top:8px', onclick: async () => {
      const u = url.value.trim();
      const t = token.value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u) || !t) { alert('URLと合言葉を、正しく入れてください。'); return; }
      sync.configure({ url: u, token: t });
      const r = await sync.syncNow('setup');
      toast(r.ok ? '同期しました' : (r.error || '同期できませんでした'));
      ctx.refresh();
    } }, '設定して同期する'));
  return card;
}

export function renderSettings(ctx) {
  const { store } = ctx;
  const c = store.counts();
  const last = store.data.meta.lastBackupAt;
  const root = h('div', { class: 'view' }, h('h1', null, '設定'));
  if (store.message) root.append(h('div', { class: 'banner bad' }, store.message));

  root.append(h('div', { class: 'card' },
    h('h2', null, 'バックアップ'),
    h('p', { class: 'small muted' }, '学習記録はこのスマホの中にだけあります。機種変更・ブラウザのデータ削除・長期間の未使用で消えることがあるので、週に1回は書き出してください。'),
    h('p', null, `記録：勉強時間 ${c.sessions}件・問題集 ${c.attempts}件・読了 ${c.marks}論点`),
    h('p', { class: 'small muted' }, last ? `最後のバックアップ：${fmtDate(toYmd(new Date(last)))}` : 'まだバックアップを取っていません'),
    h('button', { class: 'primary', style: 'width:100%', disabled: store.readOnly, onclick: async () => {
      const name = `boki2-backup-${ctx.today()}.json`;
      const r = await saveFile(store.exportJson(), name);
      if (r === 'cancelled') return;
      store.markBackedUp();
      toast(r === 'shared' ? 'バックアップを保存しました' : `${name} をダウンロードしました`);
      ctx.refresh();
    } }, 'バックアップを書き出す（ファイルに保存）'),
    h('p', { class: 'hint' }, '共有メニューで「ファイルに保存」を選ぶと、iCloud Drive などに残せます。')));

  const input = h('input', { type: 'file', accept: 'application/json,.json', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = store.parseBackup(await f.text());
    if (!r.ok) { alert(r.error); return; }
    const now = store.counts();
    const ok = confirm(
      `今の記録（勉強時間${now.sessions}件・問題集${now.attempts}件）を、\nバックアップの内容（勉強時間${r.counts.sessions}件・問題集${r.counts.attempts}件）で置き換えます。\n\n置き換え前の内容は端末内に控えが残ります。よろしいですか？`);
    if (!ok) return;
    try {
      store.replaceAll(r.data);
      toast('バックアップを読み込みました');
      ctx.refresh();
    } catch (err) {
      alert(`読み込めませんでした：${err.message}`);
    }
  } });
  root.append(h('div', { class: 'card' },
    h('h2', null, 'バックアップから戻す'),
    h('p', { class: 'small muted' }, '書き出したファイルを選ぶと、今の記録をその内容で置き換えます。'),
    input));

  root.append(syncCard(ctx));

  root.append(h('div', { class: 'card' },
    h('h2', null, 'アプリについて'),
    h('p', null, `バージョン ${VERSION}`),
    h('button', { onclick: async () => {
      if (!('serviceWorker' in navigator)) { toast('この環境では更新確認を使えません'); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { toast('更新の仕組みがまだ有効になっていません'); return; }
      await reg.update();
      toast(reg.waiting || reg.installing ? '新しいバージョンがあります。画面上部の表示から再読み込みしてください' : '最新のバージョンです');
    } }, '更新を確認する')));
  return root;
}
