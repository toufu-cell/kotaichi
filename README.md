# 個体値スコープ

Discordの専用チャンネルに評価画像を送ると、個体値と進化候補のPvP順位を自動返信します。
画像解析と順位計算はCloudflare Durable Objectsで動きます。
GameWithへのアクセスとBrowser Runは使いません。D1や常時起動する手元のPCも不要です。
[Botの設定と運用](docs/discord-bot.md)を参照してください。

## 計算と進化候補

個体値0〜15の全4,096通りを、こうげき・ぼうぎょ・HPの積で比較します。
CP制限内で育成できる最大レベルを各個体について探し、能力値の積が同じなら同順位にします。
BotはPL50上限です。スーパー・ハイパー・リトル・マスターの4リーグを返します。
Web画面では従来どおりPL40・50・51を切り替えられます。順位・CP・育成PLを表示します。

順位を固定値で登録する必要はありません。
[PvPoke](https://github.com/pvpoke/pvpoke)の種族値・進化関係・レベル補正を同梱し、要求された個体値で計算します。
日本語名には[PokéAPI](https://pokeapi.co/)を使います。本編の能力値は順位計算に流用しません。
イーブイの分岐など、登録された進化関係をたどって候補を表示します。
性別・地域・イベントなどの進化条件は判定しないため、実際に進化できるかは確認が必要です。
メガ・ゲンシ・シャドウ専用のデータは計算対象に含めません。

入力例はデルビル8 / 3 / 11です。進化候補のヘルガーはスーパー1,654位、CP1,495になります。
ハイパーはPL50上限で2,338位です。同率の扱いなどにより、他サービスの順位とは異なる場合があります。
現在のCP・PL、技、対戦相性、限定カップの参加条件は判定しません。

## Web画面と構成

[個体値スコープ](https://kotaichi.iv-scope-lab.workers.dev)をスマホで開けます。
画像は端末内のTesseract.jsとCanvasで処理します。
順位を調べるときだけ、ポケモンの識別子と個体値を利用コード付きで送ります。
Workerは静的ファイルを配信し、APIの処理をDurable Objectsへ転送します。
既存データを維持するため、Durable Objectのクラス名は`RankBrowser`のままです。

1. 名前と3本の評価バーが見えるスクリーンショットを選びます。
2. 読み取った名前・フォルムと個体値を確認し、誤読を修正します。
3. 利用コードを入力し、「この個体値で順位を調べる」を押します。
4. リーグと育成レベル上限を切り替え、進化候補も比較します。

Web画面の画像上限は20MB・3,200万画素です。PNG・JPEG・WebPに対応します。
ニックネームや表示形式の違いによっては手入力が必要です。
Webの計算結果はCache APIで最大24時間再利用します。計算方式とデータの版ごとに分けます。
旧GameWithのキャッシュは使いません。画像、利用コード、利用者情報はキャッシュしません。
画面内でも最大20件を一時保持し、再読込すると消去します。

## 起動と公開

Node.js 24以上を使います。

```sh
npm ci
npx playwright install chromium webkit
npm run deploy:check
```

Playwrightは手元での画面・OCRテスト用です。本番Workerでは使いません。
`deploy:check`は型検査、画面のビルド、Workerの配信準備を確認します。外部公開は行いません。
`npm run dev`は画面だけの開発用です。APIも使う場合はビルド後に`npm run dev:worker`で起動します。
ローカルの利用コードはGit管理外の`.dev.vars`へ置きます。

CloudflareのWorkers Freeプランで公開します。利用コードが未設定の間は順位APIが停止します。

```sh
npx wrangler login
npm run deploy
npx wrangler secret put APP_PASSWORD
```

`APP_PASSWORD`には16〜128文字の推測しにくい半角英数字を設定します。
コードをリポジトリ、チャット、URLに貼り付けないでください。
現在の管理者用コードはGit管理外の`.dev.vars.production`に保存しています。

## 無料枠

Browser Runを使わないため、ブラウザ時間の無料枠を消費しません。
Workers・Durable Objectsの無料枠は引き続き適用されます。
[Durable Objectsの公式料金表](https://developers.cloudflare.com/durable-objects/platform/pricing/)では、
Workers Freeの実行時間枠は1日13,000GB-sです。2026-09-14に確認しました。
Discordへの常時接続にもこの枠を使うため、処理できる画像枚数は利用状況によって変わります。
上限を超えると処理はエラーになります。この実装から有料プランへ変更する処理は行いません。

## 検証とデータ更新

```sh
npm test
npm run deploy:check
npm run preview -- --port 4274 --strictPort
```

別のターミナルから実画像を検証します。

```sh
npm run test:browser -- /absolute/path/to/houndour-appraisal.png
npm run test:discord-source -- /absolute/path/to/houndour-appraisal.png
npm run test:deployed -- /absolute/path/to/houndour-appraisal.png
```

チョロネコ1 / 4 / 15の画像を使う場合は、各コマンドの画像パスの後に`purrloin`を付けます。
通常テストはネットワークに依存しません。
画面テストは順位APIを固定応答に置き換え、画像認識・表示・通信失敗・中止を確認します。
`test:discord-source`は画像のダウンロードだけを手元のファイルへ置き換えます。
実際のOCRと自前計算から返信文を生成します。外部チェッカーには接続しません。
`test:deployed`は起動中のWorkerとDurable Objectsを通し、認証と実際の計算結果を確認します。
公開先を使う場合は`APP_URL`と`APP_SECRET_FILE=.dev.vars.production`を指定します。
物理的なiPhone・Android端末は未検証です。Chromium・WebKitでスマホ幅を検証します。

データ更新は次のコマンドで行います。ポケモンごとに進化先を手入力する必要はありません。

```sh
npm run data:update
npm test
npm run deploy
```

更新スクリプトが公開データを取得し、整合性を確認してJSONとライセンスを保存します。
通常ビルドは同梱データを使います。定期的な自動更新は設定していません。
提供元のコミットと更新日時はJSONに記録します。

### Test decision

- 代表テスト：`tests/ranking.test.ts`と`tests/local-ranks.test.ts`。
- 対応：既存の計算テストを再利用し、旧サイトのDOMテストをAPI形式への変換テストへ置換。
- 根拠：進化候補・PL上限・リーグごとの値を誤って対応させる変更を検出する。
- 認証・キャッシュ・Gateway・OCRの既存検証は維持。旧キャッシュの隔離と返信の説明を更新。

ポケモンGOの非公式ファンツールです。外部データのライセンスは`public/licenses/`を参照してください。
