// 学習データの保存（localStorage）。storage を差し替えられるので Node のテストでも動く。
// 方針：読み込めないデータは絶対に上書きしない。移行・取り込みの前には元データを別キーに残す。
import { toYmd, diffDays } from './dates.js';

export const STORAGE_KEY = 'boki2-app:data';
export const CURRENT_VERSION = 1;

export function emptyData() {
  return {
    schemaVersion: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    sessions: [],
    attempts: [],
    reviewQueue: [],
    topicMarks: {},
    mocks: [],
    errorReports: [],
    weeklyReviews: [],
    timer: null,
    meta: { lastBackupAt: null },
  };
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 移行表：キーは「移行前のバージョン」。関数は次のバージョンの形にして返す（schemaVersion は migrate が上げる） */
export const MIGRATIONS = {
  // v0（schemaVersion なし）→ v1：足りない項目を既定値で補い、ID のない記録に ID を振る
  0: (d) => {
    const base = emptyData();
    const withIds = (arr) => (Array.isArray(arr) ? arr : []).map((r) => (r && r.id ? r : { ...r, id: uid() }));
    return {
      ...base,
      ...d,
      sessions: withIds(d.sessions),
      attempts: withIds(d.attempts),
      reviewQueue: Array.isArray(d.reviewQueue) ? d.reviewQueue : [],
      topicMarks: d.topicMarks && typeof d.topicMarks === 'object' ? d.topicMarks : {},
      mocks: Array.isArray(d.mocks) ? d.mocks : [],
      errorReports: Array.isArray(d.errorReports) ? d.errorReports : [],
      weeklyReviews: Array.isArray(d.weeklyReviews) ? d.weeklyReviews : [],
      meta: { ...base.meta, ...(d.meta || {}) },
    };
  },
};

export class TooNewError extends Error {
  constructor(version, current) {
    super(`データのバージョン(${version})がアプリ(${current})より新しい`);
    this.name = 'TooNewError';
  }
}

export function migrate(data, migrations = MIGRATIONS, current = CURRENT_VERSION) {
  let v = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
  if (v > current) throw new TooNewError(v, current);
  let d = JSON.parse(JSON.stringify(data));
  while (v < current) {
    const fn = migrations[v];
    if (!fn) throw new Error(`バージョン${v}からの移行手順がありません`);
    d = fn(d);
    v += 1;
    d.schemaVersion = v;
  }
  return d;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export function createStore(storage, opts = {}) {
  const now = opts.now || (() => new Date());
  const migrations = opts.migrations || MIGRATIONS;
  const current = opts.current || CURRENT_VERSION;

  const store = {
    data: emptyData(),
    status: 'new', // 'new' | 'ok' | 'migrated' | 'corrupt' | 'too-new'
    readOnly: false,
    message: '',

    load() {
      let raw = null;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (e) {
        this.status = 'corrupt';
        this.readOnly = true;
        this.message = 'この端末の保存領域を読めませんでした。プライベートブラウズでは記録が残りません。';
        return this;
      }
      if (raw == null) {
        this.status = 'new';
        return this;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
        if (!isObj(parsed)) throw new Error('not an object');
      } catch {
        // 壊れたデータは別キーに退避して、上書きで失わないようにする
        try {
          storage.setItem(`${STORAGE_KEY}:corrupt:${now().getTime()}`, raw);
        } catch { /* 退避できなければ readOnly で守る */ this.readOnly = true; }
        this.status = 'corrupt';
        this.message = '保存データが壊れていたため、元のデータを退避して新しく始めました。';
        this.data = emptyData();
        return this;
      }
      const v = Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 0;
      if (v > current) {
        this.status = 'too-new';
        this.readOnly = true;
        this.message = 'このデータは、より新しいバージョンのアプリで作られています。アプリを更新してから開き直してください（記録はそのまま残っています）。';
        this.data = emptyData();
        return this;
      }
      if (v < current) {
        const migrated = migrate(parsed, migrations, current);
        try {
          storage.setItem(`${STORAGE_KEY}:pre-v${v}`, raw); // 移行前の控え
        } catch { /* 控えが作れなくても移行は続ける */ }
        this.data = migrated;
        this.status = 'migrated';
        this.save();
        return this;
      }
      this.data = migrate(parsed, migrations, current); // 同バージョンでも欠けた項目は補う
      this.status = 'ok';
      return this;
    },

    save() {
      if (this.readOnly) throw new Error(this.message || '読み取り専用のため保存できません');
      storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    },

    // ---- 勉強時間 ----
    addSession({ date, slot, minutes, topicId = null, kind = 'input', note = '', source = 'manual' }) {
      const s = { id: uid(), date, slot, minutes: Math.round(minutes), topicId: topicId || null, kind, note, source, createdAt: now().toISOString() };
      this.data.sessions.push(s);
      this.save();
      return s;
    },
    deleteSession(id) {
      this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
      this.save();
    },

    // ---- タイマー（開始時刻ベース：閉じても画面ロックしても経過時間は狂わない）----
    startTimer({ slot, topicId = null, kind = 'input' }) {
      if (this.data.timer) throw new Error('タイマーはすでに動いています');
      this.data.timer = { startedAt: now().toISOString(), slot, topicId: topicId || null, kind };
      this.save();
      return this.data.timer;
    },
    timerElapsedMs() {
      return this.data.timer ? now().getTime() - new Date(this.data.timer.startedAt).getTime() : 0;
    },
    stopTimer() {
      const t = this.data.timer;
      if (!t) return null;
      const minutes = Math.max(1, Math.round(this.timerElapsedMs() / 60000));
      const s = this.addSessionFromTimer(t, minutes);
      this.data.timer = null;
      this.save();
      return s;
    },
    addSessionFromTimer(t, minutes) {
      const s = {
        id: uid(), date: toYmd(new Date(t.startedAt)), slot: t.slot, minutes, topicId: t.topicId, kind: t.kind,
        note: '', source: 'timer', createdAt: now().toISOString(),
      };
      this.data.sessions.push(s);
      return s;
    },
    cancelTimer() {
      this.data.timer = null;
      this.save();
    },

    // ---- 解答（問題集ログ・ミニテスト）----
    addAttempt({ topicId, score, inTime = null, sec = null, mode = 'workbook', ref = null, questionId = null, date }) {
      const t = now();
      const a = { id: uid(), ts: t.toISOString(), date: date || toYmd(t), topicId, mode, ref, questionId, score, inTime, sec };
      this.data.attempts.push(a);
      this.save();
      return a;
    },
    deleteAttempt(id) {
      this.data.attempts = this.data.attempts.filter((a) => a.id !== id);
      this.save();
    },

    // ---- 「テキストを読んだ」----
    setTopicRead(topicId, read) {
      if (read) this.data.topicMarks[topicId] = { readAt: now().toISOString(), readDate: toYmd(now()) };
      else delete this.data.topicMarks[topicId];
      this.save();
    },

    // ---- バックアップ ----
    exportJson() {
      const out = { app: 'boki2-app', exportedAt: now().toISOString(), data: { ...this.data, meta: { ...this.data.meta, lastBackupAt: now().toISOString() } } };
      return JSON.stringify(out, null, 2);
    },
    markBackedUp() {
      this.data.meta.lastBackupAt = now().toISOString();
      this.save();
    },
    /** バックアップの文章を検査して、取り込める形にする。置き換えはしない */
    parseBackup(text) {
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        return { ok: false, error: 'ファイルの中身を読めませんでした（JSONではありません）。' };
      }
      const payload = isObj(obj) && obj.app === 'boki2-app' && isObj(obj.data) ? obj.data : obj;
      if (!isObj(payload) || !Array.isArray(payload.sessions) || !Array.isArray(payload.attempts)) {
        return { ok: false, error: 'このアプリのバックアップファイルではないようです。' };
      }
      try {
        const data = migrate(payload, migrations, current);
        return { ok: true, data, counts: counts(data) };
      } catch (e) {
        if (e instanceof TooNewError) return { ok: false, error: '新しいバージョンのアプリで作られたバックアップです。アプリを更新してから取り込んでください。' };
        return { ok: false, error: `取り込みに失敗しました：${e.message}` };
      }
    },
    /** 全データを置き換える。置き換え前の内容は別キーに残す */
    replaceAll(data) {
      if (this.readOnly) throw new Error(this.message);
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw != null) storage.setItem(`${STORAGE_KEY}:pre-import`, raw);
      } catch { /* 控えが作れなくても続ける */ }
      this.data = data;
      this.data.timer = null;
      this.save();
    },

    counts() {
      return counts(this.data);
    },
  };
  return store;
}

export function counts(d) {
  return { sessions: d.sessions.length, attempts: d.attempts.length, marks: Object.keys(d.topicMarks).length };
}

/** バックアップを促す日数。記録があって、未バックアップまたは intervalDays 日以上たっていれば経過日数（未バックアップは Infinity）を返す。不要なら null */
export function backupDueDays(data, todayYmd, intervalDays = 7) {
  const has = data.sessions.length + data.attempts.length + Object.keys(data.topicMarks).length > 0;
  if (!has) return null;
  const last = data.meta && data.meta.lastBackupAt;
  if (!last) return Infinity;
  const days = diffDays(toYmd(new Date(last)), todayYmd);
  return days >= intervalDays ? days : null;
}
