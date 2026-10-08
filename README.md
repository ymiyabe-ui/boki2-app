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
│   ├── grade.js        … 採点（仕訳は順番不問・同じ科目は合算）
│   ├── review.js       … 再出題の予定（1日後・3日後・7日後で卒業）
│   ├── dailyset.js     … 毎日のセット（5問＋再出題3問）の組み立て
│   ├── forecast.js     … 合格見込み点・模試と予測の差
│   ├── weekly.js       … 週末の総復習（セット・集計・来週の推奨）
│   ├── report.js       … 週次レポート（JSON）の組み立て
│   ├── ui.js           … 画面の共通部品
│   ├── version.js
│   └── views/          … ホーム・時間・ミニテスト・週末の総復習・問題集・論点・設定の各画面
├── data/               … topics / config / plan / holidays / accounts（静的データ）
│   ├── questions/      … 論点ごとの問題（c01.json …）と索引 index.json
│   └── lessons/        … 論点ごとの講義（c01.json …）と索引 index.json
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

## 講義を追加・直すとき

1. `data/lessons/cNN.json` を作る（形は `CLAUDE.md` の「講義機能で決まったこと」）。文章はオリジナルで書く。AIが作ったものは `verified: false`
2. `data/lessons/index.json` と `sw.js` の `ASSETS` にファイルを足す
3. `node scripts/validate-questions.mjs` で検証する（講義も対象）
4. 講義を修正したら `rev` を1上げる

## 問題を追加・直すとき

1. `data/questions/<論点ID>.json` に追加する（形式は boki2-app-PROMPT.md の「5. データ設計」）。新しいファイルなら `index.json` と `sw.js` の保存対象にも足す
2. 金額を含む問題は `checks` に計算式を書く。AIが作った問題は `verified: false`
3. `node scripts/validate-questions.mjs` で検証する（必須項目・論点ID・勘定科目・貸借の一致・計算式の再計算・ID重複）
4. 問題を修正したら `rev` を1上げる（IDは変えない・再利用しない）

## 更新を出すとき

```
node scripts/set-version.mjs 0.2.0   # 版をそろえて変更
node scripts/validate-questions.mjs   # 問題データの検証
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
