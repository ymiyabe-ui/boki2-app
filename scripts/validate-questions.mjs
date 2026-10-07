// 問題データの検証。使い方: node scripts/validate-questions.mjs
// 必須項目・論点IDの存在・勘定科目の存在・貸借の一致・計算式の再計算・IDの重複・最初の3週分の問題数をチェックする。
// 問題を追加・修正したら、commit の前に必ず実行する（node --test でも同じ検証が走る）。
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateQuestions } from './validate-lib.mjs';

const dir = (rel) => fileURLToPath(new URL(`../data/${rel}`, import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

export async function loadAll() {
  const qdir = dir('questions/');
  const names = (await readdir(qdir)).filter((n) => /^[a-z]\d+\.json$/.test(n));
  const files = {};
  for (const n of names) files[n] = await json(`${qdir}${n}`);
  return {
    files,
    index: await json(`${qdir}index.json`),
    topics: (await json(dir('topics.json'))).topics,
    accounts: (await json(dir('accounts.json'))).accounts,
    plan: await json(dir('plan.json')),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = await loadAll();
  const errors = validateQuestions(input);
  const total = Object.values(input.files).reduce((a, f) => a + f.questions.length, 0);
  if (errors.length) {
    console.error(`問題データに ${errors.length} 件の問題があります：`);
    for (const e of errors) console.error(`  ・${e}`);
    process.exit(1);
  }
  console.log(`問題データは正常です（${Object.keys(input.files).length}論点・${total}問）`);
}
