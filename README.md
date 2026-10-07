# 簿記2級 学習アプリ

日商簿記2級の合格に向けて、勉強時間（投入量）と習熟度（成果）の2軸で学習を管理する個人用のWebアプリ（PWA）です。

- 公開URL：https://ymiyabe-ui.github.io/boki2-app/
- 学習記録はスマホの中（localStorage）にだけ保存され、このリポジトリには入りません
- アプリ内の問題はすべてオリジナルです。市販のテキスト・問題集の問題文や解説は載せていません

## フォルダ構成

```
.
├── index.html          … アプリ本体（Phase 0 は「準備中」画面）
├── data/
│   ├── topics.json     … 論点マップ（並び順＝学習順）
│   ├── config.json     … プラン・受験日・目標時間・判定しきい値など
│   └── plan.json       … 週ごとの論点の割り当て
├── scripts/serve.mjs   … ローカル確認用の簡易サーバー（依存なし）
├── test/               … node --test で動くテスト
├── private/            … 週次レポートの保存先（Gitに入れない）
├── CLAUDE.md           … Claude Code 向けの決定事項と進捗
├── CHANGELOG.md
└── boki2-app-PROMPT.md … 作業指示書（Phaseごとの作業内容）
```

## PCで確認する

Node.js が入っていれば、このフォルダで次を実行します。

```
node scripts/serve.mjs
```

表示された `http://localhost:8080/boki2-app/` をブラウザで開きます。止めるときは Ctrl+C。

## テスト

```
node --test
```

## 受験日やプランを変えるとき

`data/config.json` の `examDate` と、`data/plan.json` の `examDate`・週の割り当てを書き換えます。テストが両者の食い違いを検出します。
