// 設定：バックアップの書き出し・読み込み、バージョン、アプリの更新確認
import { h, toast, fmtDate } from '../ui.js';
import { toYmd } from '../dates.js';
import { VERSION } from '../version.js';

async function saveFile(text, name) {
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
