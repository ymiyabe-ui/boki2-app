// 端末間の同期。サーバー（Google Apps Script）は「記録を1つ置いておく場所」だけで、まとめる処理は端末側（merge.js）で行う。
// 流れ：サーバーから取る → 自分の記録とまとめる → 版番号つきで書き戻す（他の端末が先に書いていたらやり直し）→ 自分の記録も更新する。
import { mergeData, sameContent, forServer, isEmptyData } from './merge.js';
import { migrate, STORAGE_KEY } from './store.js';

export const SYNC_KEY = 'boki2-app:sync';
const GAS_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

export function readConfig(storage) {
  try {
    const raw = storage.getItem(SYNC_KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c && c.url && c.token ? c : null;
  } catch {
    return null;
  }
}
const writeConfig = (storage, cfg) => { try { storage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch { /* 保存できなければ、次回また設定する */ } };

/** 設定リンク（#/setup-sync?u=…&t=…）を読む。Google Apps Script のウェブアプリのURL以外は受け付けない */
export function parseSetupHash(hash) {
  const m = /^#\/setup-sync\?(.*)$/.exec(hash || '');
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const url = q.get('u');
  const token = q.get('t');
  if (!url || !token || !GAS_URL.test(url)) return null;
  return { url, token };
}

/**
 * 同期の部品。store は createStore の結果、storage は設定の保存先、fetchImpl は fetch。
 * intervals は再出題の間隔（config.reviewIntervalsDays）。
 */
export function createSync({
  store, storage, fetchImpl, intervals, now = () => new Date(),
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t),
  debounceMs = 4000, minGapMs = 20000, onChanged = () => {},
}) {
  let cfg = readConfig(storage);
  let running = null;
  let again = false;
  let timer = null;
  let lastRunAt = 0;
  const state = { lastSyncAt: cfg && cfg.lastSyncAt ? cfg.lastSyncAt : null, lastError: null };

  async function call(body) {
    let res;
    try {
      res = await fetchImpl(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, ...body }) });
    } catch {
      throw new SyncError('network', '通信できませんでした。電波のよいところで、もう一度試します');
    }
    if (!res.ok) throw new SyncError('http', `サーバーがエラーを返しました（${res.status}）`);
    let json;
    try { json = await res.json(); } catch { throw new SyncError('format', 'サーバーの応答を読めませんでした。URLが正しいか確認してください'); }
    if (json && json.ok === false && json.error === 'auth') throw new SyncError('auth', '合言葉が違います。同期の設定をやり直してください');
    if (json && json.ok === false && json.error === 'busy') throw new SyncError('busy', 'サーバーが混み合っています。少しあとで、もう一度試します');
    return json;
  }

  const normalize = (data) => {
    try { return migrate(data); } catch (e) {
      if (e && e.name === 'TooNewError') throw new SyncError('too-new', 'サーバーの記録が、より新しい版のアプリで作られています。アプリを更新してください');
      throw new SyncError('format', 'サーバーの記録を読めませんでした');
    }
  };

  async function run() {
    const startCount = store.changeCount;
    if (cfg.rev == null) {
      // 初めての同期の前に、この端末の記録を控えておく
      try { const raw = storage.getItem(STORAGE_KEY); if (raw != null) storage.setItem(`${STORAGE_KEY}:pre-sync`, raw); } catch { /* 控えが作れなくても続ける */ }
    }
    let merged = null;
    let rev = null;
    for (let i = 0; i < 4 && rev == null; i++) {
      const got = await call({ op: 'get' });
      if (!got || got.ok !== true) throw new SyncError('format', 'サーバーの応答が想定と違います');
      const remote = got.data ? normalize(got.data) : null;
      merged = mergeData(store.data, remote || {}, { intervals });
      if (remote ? sameContent(merged, remote) : isEmptyData(merged)) { rev = got.rev; break; } // 送るものがない
      const put = await call({ op: 'put', baseRev: got.rev, data: forServer(merged) });
      if (put && put.ok) rev = put.rev;
      else if (!(put && put.conflict)) throw new SyncError('server', `サーバーに書き込めませんでした（${put && put.error ? put.error : '不明'}）`);
    }
    if (rev == null) throw new SyncError('conflict', '他の端末と同時に同期したため、あとでもう一度試します');

    // 同期の途中で記録が増えているかもしれないので、今の記録ともう一度まとめてから取り込む
    const dirty = store.changeCount !== startCount;
    const final = mergeData(store.data, merged, { intervals });
    const changed = !sameContent(final, store.data) || JSON.stringify(final.reviewQueue) !== JSON.stringify(store.data.reviewQueue);
    if (changed) store.applySynced(final);
    cfg = { ...cfg, rev, lastSyncAt: now().toISOString() };
    writeConfig(storage, cfg);
    state.lastSyncAt = cfg.lastSyncAt;
    if (dirty) schedule();
    return { ok: true, changed };
  }

  async function syncNow(reason = 'manual') {
    if (!cfg) return { ok: false, skipped: 'off' };
    if (store.readOnly) return { ok: false, skipped: 'readonly' };
    if (reason === 'visible' && now().getTime() - lastRunAt < minGapMs) return { ok: false, skipped: 'recent' };
    if (running) { again = true; return running; }
    lastRunAt = now().getTime();
    running = (async () => {
      try {
        const r = await run();
        state.lastError = null;
        if (r.changed) onChanged();
        return r;
      } catch (e) {
        state.lastError = e instanceof SyncError ? e.message : `同期できませんでした（${e && e.message ? e.message : e}）`;
        return { ok: false, error: state.lastError, code: e && e.code };
      } finally {
        running = null;
        if (again) { again = false; schedule(); }
      }
    })();
    return running;
  }

  function schedule() {
    if (!cfg) return;
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => { timer = null; syncNow('auto'); }, debounceMs);
  }

  return {
    isConfigured: () => !!cfg,
    status: () => ({ configured: !!cfg, running: !!running, lastSyncAt: state.lastSyncAt, lastError: state.lastError, url: cfg ? cfg.url : null }),
    configure({ url, token }) {
      cfg = { url, token, rev: null, lastSyncAt: null };
      state.lastSyncAt = null;
      state.lastError = null;
      writeConfig(storage, cfg);
    },
    clear() {
      cfg = null;
      if (timer != null) { clearTimer(timer); timer = null; }
      try { storage.removeItem(SYNC_KEY); } catch { /* 無視 */ }
      state.lastSyncAt = null;
      state.lastError = null;
    },
    syncNow,
    schedule,
  };
}
