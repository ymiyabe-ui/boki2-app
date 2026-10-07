// Service Worker：アプリ一式を端末に保存してオフラインでも動かす。
// 更新の流れ：VERSION を上げる → 新しいキャッシュを作って待機 → アプリ上の「再読み込み」で切り替え。
// VERSION は package.json・js/version.js と同じ値（scripts/set-version.mjs で一括変更）
const VERSION = '0.3.0';
const CACHE = `boki2-app-v${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/version.js',
  './js/dates.js',
  './js/stats.js',
  './js/mastery.js',
  './js/store.js',
  './js/ui.js',
  './js/grade.js',
  './js/journal.js',
  './js/review.js',
  './js/dailyset.js',
  './js/views/quiz.js',
  './js/views/weekly.js',
  './js/views/weekly-parts.js',
  './js/forecast.js',
  './js/weekly.js',
  './js/report.js',
  './js/views/parts.js',
  './js/views/home.js',
  './js/views/record.js',
  './js/views/workbook.js',
  './js/views/topics.js',
  './js/views/settings.js',
  './data/topics.json',
  './data/config.json',
  './data/plan.json',
  './data/holidays.json',
  './data/accounts.json',
  './data/questions/index.json',
  './data/questions/c01.json',
  './data/questions/c02.json',
  './data/questions/c03.json',
  './data/questions/c04.json',
  './data/questions/c05.json',
  './data/questions/c06.json',
  './data/questions/c07.json',
  './data/questions/c08.json',
  './data/questions/c09.json',
  './data/questions/c10.json',
  './data/questions/c11.json',
  './data/questions/c12.json',
  './data/questions/c13.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // skipWaiting はしない。利用者が「再読み込み」を押すまで、今の版のまま動かす
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('boki2-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
