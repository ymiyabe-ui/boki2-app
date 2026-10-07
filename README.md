# 簿記2級 学習アプリ

日商簿記2級の合格に向けて、勉強時間（投入量）と習熟度（成果）の2軸で学習を管理する個人用のWebアプリ（PWA）です。

- 公開URL：https://ymiyabe-ui.github.io/boki2-app/
- 学習記録はスマホの中（localStorage）にだけ保存され、このリポジトリには入りません
- アプリ内の問題はすべてオリジナルです。市販のテキスト・問題集の問題文や解説は載せていません

## フォルダ構成

```
.
├── index.html / manifest.webmanifest / sw.js   … 入口・PWAの設定・オフライン用Service Worker
├── css/app.css
├── js/
│   ├── app.js          … 起動・画面切り替え・更新通知
│   ├── dates.js        … 日付・週・平日／休日・目標時間
│   ├── stats.js        … 勉強時間の集計（週・累計・計画の何週目か）
│   ├── mastery.js      … 習熟度の判定・再挑戦リスト
│   ├── store.js        … 端末内の保存・移行・バックアップ・タイマー
│   ├── ui.js           … 画面の共通部品
│   ├── version.js
│   └── views/          … ホーム・時間・問題集・論点・設定の各画面
├── data/               … topics / config / plan / holidays（静的データ）
├── icons/              … ホーム画面用アイコン
├── scripts/            … serve.mjs（確認用サーバー）、set-version.mjs、make-icons.mjs
├── test/               … node --test で動くテスト
├── private/            … 週次レポートの保存先（Gitに入れない）
├── CLAUDE.md / CHANGELOG.md / boki2-app-PROMPT.md
```

## iPhone で使う

1. Safari で公開URLを開く
2. 共有ボタン →「ホーム画面に追加」
3. 以降はホーム画面のアイコンから開く（ブラウザで開くより記録が消えにくい）
4. 設定タブの「バックアップを書き出す」を週1回。共有メニューで「ファイルに保存」を選ぶ

## 更新を出すとき

```
node scripts/set-version.mjs 0.2.0   # 版をそろえて変更
node --test
```

commit・タグ・push のあと、スマホでアプリを開くと「新しいバージョンがあります」と出るので「再読み込み」を押す。

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
