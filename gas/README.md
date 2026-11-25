# 同期サーバー（Google Apps Script）

簿記2級 学習アプリの、PCとスマホの記録を同期するためのサーバーです。やることは、学習記録を、自分のGoogleドライブのファイル1つに置いておくことだけです。記録のまとめ方は、アプリ側（`js/merge.js`）が行います。

- 動かすアカウント：**個人のGoogleアカウント**（会社のアカウントでは動かさない）
- 置き場所：マイドライブの `boki2-app-sync.json`（最新）と `boki2-app-sync.prev.json`（1つ前の状態）
- 認証：合言葉（スクリプトプロパティ `SYNC_TOKEN`）。ソースにも、リポジトリにも書かない
- 公開範囲：ウェブアプリは「全員（匿名）」で公開されるが、合言葉がなければ、何も読み書きできない

## 最初の設定（1回だけ）

1. 個人のGoogleアカウントで、`gas/` に移って `clasp create-script --title "boki2-app-sync" --type standalone` を実行する（スクリプトIDが `.clasp.json` に入る。コミットしない）
2. `appsscript.json` が上書きされるので、このリポジトリの内容に戻す
3. `gas/Local.js` に、公開URLを書く（コミットしない）：`var WEBAPP_URL = 'https://script.google.com/macros/s/…/exec';`
4. `clasp push --force` → `clasp create-deployment --description "同期サーバー v1"`。出た「デプロイID」から、公開URL（`https://script.google.com/macros/s/<デプロイID>/exec`）が決まる
5. `clasp open-script` でエディタを開き、関数 `setup` を選んで「実行」する。初回は権限の確認が出るので、「詳細」→「（安全でないページ）に移動」→許可する
6. 実行ログに出る「設定リンク」をコピーして、スマホとPCで、それぞれ1回ずつ開く。確認が出たら「OK」。人には見せない（合言葉が入っている）

## コードを直したとき

1. `gas/` で `clasp push --force`
2. `clasp redeploy <デプロイID> --description "…"`（同じURLのまま、新しい版になる）

## 合言葉を変えたいとき（漏れたかもしれないとき）

エディタで関数 `resetToken` を実行し、新しい設定リンクを出して、各端末で開き直す。

## 困ったとき

- アプリの設定画面に「合言葉が違います」と出る → 設定リンクをもう一度開く
- 「サーバーの応答を読めませんでした」と出る → URLが `/exec` で終わっているか、デプロイが「全員（匿名）」になっているか確認する
- 記録がおかしくなったとき → Driveの `boki2-app-sync.prev.json` に、1つ前の状態が残っている。端末側にも、初めての同期の前の控え（`boki2-app:data:pre-sync`）と、バックアップのファイルがある
