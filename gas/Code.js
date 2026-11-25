// 簿記2級 学習アプリの同期サーバー（Google Apps Script のウェブアプリ）。
// やること：学習記録を、Drive のファイル1つに置いておく。取り出す（get）と、版番号つきで書き込む（put）だけ。
// 記録のまとめ方は、アプリ側（js/merge.js）が行う。ここは、他の端末が先に書いていたら書き込みを断って、版番号を返すだけ。
// 合言葉（SYNC_TOKEN）は、スクリプトプロパティに置く。ソースには書かない。

var FILE_NAME = 'boki2-app-sync.json';
var PREV_NAME = 'boki2-app-sync.prev.json';
var MAX_CHARS = 8 * 1024 * 1024;
var APP_URL = 'https://ymiyabe-ui.github.io/boki2-app/';

function doGet() {
  return json_({ ok: true, app: 'boki2-app-sync', note: 'このURLは、アプリから POST で使います' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad-request' });
  }
  var token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!token || !req || typeof req.token !== 'string' || !safeEqual_(req.token, token)) {
    return json_({ ok: false, error: 'auth' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }
  try {
    return json_(handle_(req));
  } finally {
    lock.releaseLock();
  }
}

function handle_(req) {
  var file = stateFile_();
  var text = file.getBlob().getDataAsString('UTF-8');
  var state = JSON.parse(text);
  if (req.op === 'get') {
    return { ok: true, rev: state.rev, data: state.data };
  }
  if (req.op === 'put') {
    if (req.baseRev !== state.rev) return { ok: false, conflict: true, rev: state.rev };
    var d = req.data;
    if (!d || typeof d !== 'object' || !Array.isArray(d.sessions) || !Array.isArray(d.attempts)) {
      return { ok: false, error: 'bad-request' };
    }
    var next = JSON.stringify({ rev: state.rev + 1, savedAt: new Date().toISOString(), data: d });
    if (next.length > MAX_CHARS) return { ok: false, error: 'too-large' };
    prevFile_().setContent(text); // 1つ前の状態を残しておく（万一のとき戻せるように）
    file.setContent(next);
    return { ok: true, rev: state.rev + 1 };
  }
  return { ok: false, error: 'bad-op' };
}

/** 初回に1度だけ、エディタで実行する。合言葉を作り、保存用のファイルを用意して、各端末で開く設定リンクをログに出す */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty('SYNC_TOKEN', token);
  }
  stateFile_();
  // 公開用のURL（/exec）。Local.js（コミットしない）に WEBAPP_URL を書いてあればそれを使う。なければ、現在のウェブアプリのURL
  var url = (typeof WEBAPP_URL === 'string' && WEBAPP_URL) ? WEBAPP_URL : ScriptApp.getService().getUrl();
  var link = APP_URL + '#/setup-sync?u=' + encodeURIComponent(url) + '&t=' + encodeURIComponent(token);
  Logger.log('同期先のURL：' + url);
  Logger.log('設定リンク（スマホとPCで、それぞれ開く。人には見せない）：\n' + link);
  return link;
}

/** 合言葉を作り直したいとき（漏れたかもしれないとき）。実行後、各端末の設定をやり直す */
function resetToken() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_TOKEN');
  return setup();
}

function stateFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SYNC_FILE_ID');
  if (id) {
    try {
      return DriveApp.getFileById(id);
    } catch (err) { /* 見つからなければ作り直す */ }
  }
  var f = DriveApp.createFile(FILE_NAME, JSON.stringify({ rev: 0, savedAt: null, data: null }), MimeType.PLAIN_TEXT);
  props.setProperty('SYNC_FILE_ID', f.getId());
  return f;
}

function prevFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SYNC_PREV_FILE_ID');
  if (id) {
    try {
      return DriveApp.getFileById(id);
    } catch (err) { /* 見つからなければ作り直す */ }
  }
  var f = DriveApp.createFile(PREV_NAME, '{}', MimeType.PLAIN_TEXT);
  props.setProperty('SYNC_PREV_FILE_ID', f.getId());
  return f;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
