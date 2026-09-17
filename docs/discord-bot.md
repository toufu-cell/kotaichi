# Discord Bot運用ガイド

## Discordの設定

1. [Discord Developer Portal](https://discord.com/developers/applications)でApplicationを作成します。
2. Bot設定でMessage Content Intentを有効にし、Botトークンを発行します。
3. OAuth2 URL Generatorで`bot`を選び、View Channels・Send Messages・Read Message Historyを付けてサーバーへ招待します。
4. 専用テキストチャンネルでBotの閲覧と返信を許可し、Discordの開発者モードでチャンネルIDをコピーします。

Botトークンと管理用パスワードは、チャットやリポジトリへ記録せず、Wranglerの入力欄へ直接入力してください。

## Cloudflareへの公開

Node.js 24の環境で依存関係を用意し、3つの値をSecretとして登録します。`APP_PASSWORD`は16文字以上にします。

```sh
npm ci
npx wrangler login
npx wrangler secret put APP_PASSWORD
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_CHANNEL_ID
npm run deploy
```

Durable Objectのbindingとinstanceは次の組み合わせです。

| binding | class | instance |
| --- | --- | --- |
| `RANK_BROWSER` | `RankBrowser` | `rank` |
| `DISCORD_GATEWAY` | `DiscordGateway` | `discord` |

`ASSETS`には日本語OCRモデルだけを配置します。公開WorkerがGatewayへ渡すパスは、`/api/bot/start`、`/api/bot/stop`、`/api/bot/status`の3つです。

## 管理CLI

管理CLI用のファイルをローカルに作成します。このファイルはGitの対象外です。

```dotenv
APP_PASSWORD="16文字以上の管理用パスワード"
```

標準のファイル名は`.dev.vars.production`です。別のファイルは`APP_SECRET_FILE`、別の公開先は`APP_URL`で指定します。

```sh
npm run bot -- start
npm run bot -- status
npm run bot -- stop
```

`status`では主に次の項目を確認します。

| 項目 | 内容 |
| --- | --- |
| `enabled` | Botの起動設定 |
| `connected` | Discord Gatewayへの接続状態 |
| `queued` | 処理待ち画像の件数 |
| `issue` | 運用上の問題 |
| `uncertainReplies` | 送信結果を確定できなかった返信の件数 |
| `rejectedMessages` | 待ち行列へ追加できなかった投稿の件数 |

起動直後は接続処理中のため、`connected`が一時的に`false`になる場合があります。`issue`に認証や権限の問題が表示された場合は、Discordの設定を修正してから`start`を実行します。

## 使い方

ポケモン名と3本の評価バーが見えるPNG・JPEG・WebPを専用チャンネルへ投稿します。画像は1枚あたり8MB、800万画素までです。幅250ピクセル以上、高さ400ピクセル以上の画像を使用します。

複数画像は添付順に処理され、画像ごとに番号付きの返信が返ります。
1枚だけ添付した投稿では、本文のポケモン名と個体値を半角スペースで区切ると、その内容で計算します。
個体値はこうげき・ぼうぎょ・HPの順に、`1/4/15`のように指定します。

返信にはPL50上限の4リーグ、進化先、フォルム候補が含まれます。上位1〜30位は星と太字で強調されます。読み取った名前と個体値を投稿した画像と見比べてください。

待ち行列は処理中を含めて20枚までです。送信結果を確定できなかった返信は、自動再送による重複を避けるため`uncertainReplies`へ計上されます。該当する画像は再投稿してください。

## 検証

```sh
npm run build
npm test
npm run deploy:check
npm run test:discord-source -- /absolute/path/to/purrloin-appraisal.png purrloin
```

画像テストには、個体値がこうげき1・ぼうぎょ4・HP15のチョロネコの評価画像を用意します。

ローカルWranglerを起動して検証する場合は、`.dev.vars`に開発用の`APP_PASSWORD`を設定します。

```sh
npm run dev:worker
npm run test:deployed
```

`test:deployed`はBotの状態を変更せず、管理パスの認証、状態応答、その他の公開パスが404になることを確認します。

## データとライセンス

順位計算には[PvPoke](https://github.com/pvpoke/pvpoke)のデータ、日本語名には[PokéAPI](https://pokeapi.co/)のデータを使います。各データのライセンスは[public/licenses](../public/licenses/)に収録しています。

ポケモンGOの非公式ファンツールです。Pokémonおよび関連名称は各権利者に帰属します。
