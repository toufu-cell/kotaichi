# kotaichi

Discordへ投稿されたポケモンGOの評価画像から、個体値とPvP順位を返すCloudflare Workers Botです。Discord Gatewayの接続状態と処理待ちデータをDurable Objectsで管理し、画像認識と順位計算をCloudflare上で実行します。

## 主な機能

- ポケモン名と、こうげき・ぼうぎょ・HPの個体値を画像から読み取ります。
- PL50を上限として、スーパー・ハイパー・リトル・マスターの順位を計算します。
- 進化先とフォルム候補を表示します。
- 複数画像を順番に処理し、上位30位を星と太字で強調します。
- 画像を1枚添付し、本文にポケモン名と`1/4/15`のような個体値を半角スペースで区切って書くと、その内容で計算します。

## セットアップ

Node.js 24を使用します。

```sh
npm ci
npx wrangler login
npx wrangler secret put APP_PASSWORD
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_CHANNEL_ID
npm run deploy
```

`APP_PASSWORD`には16文字以上の管理用パスワードを設定します。Botの作成、Message Content Intent、招待権限、管理CLIの手順は[Discord Bot運用ガイド](docs/discord-bot.md)を参照してください。

管理CLIは`.dev.vars.production`から`APP_PASSWORD`を読み取ります。

```dotenv
APP_PASSWORD="16文字以上の管理用パスワード"
```

```sh
npm run bot -- start
npm run bot -- status
npm run bot -- stop
```

公開先を変更する場合は、`APP_URL`にHTTPSのWorker URLを指定します。

## 開発と検証

```sh
npm run build
npm test
npm run deploy:check
npm run test:discord-source -- /absolute/path/to/purrloin-appraisal.png purrloin
```

画像テストには、個体値がこうげき1・ぼうぎょ4・HP15のチョロネコの評価画像を用意します。

`build`は共有コードとBotコードの型を確認し、`dist/ocr/jpn.traineddata.gz`を生成します。`test:deployed`はBotの状態を変更せず、公開ルート、認証、状態応答を検証します。

```sh
APP_URL=https://example.workers.dev \
APP_SECRET_FILE=.dev.vars.production \
npm run test:deployed
```

ポケモンデータを更新する場合は、`npm run data:update`の後に上記のコマンドで確認します。

## データとライセンス

種族値・進化関係・レベル補正には[PvPoke](https://github.com/pvpoke/pvpoke)のデータを使います。日本語名には[PokéAPI](https://pokeapi.co/)のデータを使います。ライセンスは[public/licenses](public/licenses/)に収録しています。

ポケモンGOの非公式ファンツールです。Pokémonおよび関連名称は各権利者に帰属します。
