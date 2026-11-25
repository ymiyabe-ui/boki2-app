// gas/Code.js を、Google の部品（Drive・ロック・プロパティなど）の代わりを付けて Node で動かす。
// 同期のテストで、本物のサーバーの代わりに使う（fetch の代わりの関数も返す）。
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function makeFakeGas() {
  const props = new Map();
  const files = new Map();
  let n = 0;
  const fileObj = (id) => ({
    getId: () => id,
    getBlob: () => ({ getDataAsString: () => files.get(id).content }),
    setContent: (c) => { files.get(id).content = c; },
  });
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => props.set(k, String(v)),
      deleteProperty: (k) => props.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      createFile: (name, content) => { const id = `file${++n}`; files.set(id, { name, content }); return fileObj(id); },
      getFileById: (id) => { if (!files.has(id)) throw new Error('not found'); return fileObj(id); },
    },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    Utilities: { getUuid: () => 'abcdef12-3456-7890-abcd-ef1234567890' },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTID/exec' }) },
    Logger: { log() {} },
    JSON, Date, Array, Object, String,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8'), sandbox);
  const link = sandbox.setup();
  const token = props.get('SYNC_TOKEN');
  const post = (body) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  // fetch の代わり
  const fetchImpl = async (url, opts) => {
    const text = sandbox.doPost({ postData: { contents: opts.body } }).getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
  return { sandbox, props, files, link, token, post, fetchImpl };
}
