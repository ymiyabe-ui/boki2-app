// 日付まわり（すべて端末のローカル時間、日付は 'YYYY-MM-DD' の文字列で扱う）
export const SLOTS = ['morning', 'noon', 'night', 'holiday'];
export const SLOT_LABELS = { morning: '朝', noon: '昼', night: '夜', holiday: '休日' };
export const KIND_LABELS = { input: 'インプット', workbook: '問題集', minitest: 'ミニテスト', mock: '模試' };

const pad = (n) => String(n).padStart(2, '0');

export function toYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(ymd, n) {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** b - a（日数） */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** その日を含む週の月曜 */
export function weekStartOf(ymd) {
  const dow = (parseYmd(ymd).getDay() + 6) % 7; // 月=0 … 日=6
  return addDays(ymd, -dow);
}

/** 'weekday'（平日）か 'holiday'（土日・祝日）。holidayMap は { 'YYYY-MM-DD': 名前 } */
export function dayType(ymd, holidayMap = {}) {
  const dow = parseYmd(ymd).getDay();
  return dow === 0 || dow === 6 || holidayMap[ymd] ? 'holiday' : 'weekday';
}

/** 時間帯の初期値。休日は 'holiday'、平日は時刻で朝・昼・夜 */
export function defaultSlot(ymd, hour, holidayMap = {}) {
  if (dayType(ymd, holidayMap) === 'holiday') return 'holiday';
  if (hour < 11) return 'morning';
  if (hour < 15) return 'noon';
  return 'night';
}

/** その日の目標時間（分）を時間帯別に返す */
export function dayTargets(ymd, config, holidayMap = {}) {
  const t = config.targetMinutes;
  if (dayType(ymd, holidayMap) === 'holiday') {
    return { morning: 0, noon: 0, night: 0, holiday: t.holiday.total };
  }
  return { morning: t.weekday.morning, noon: t.weekday.noon, night: t.weekday.night, holiday: 0 };
}

export const sumSlots = (o) => SLOTS.reduce((a, s) => a + (o[s] || 0), 0);
