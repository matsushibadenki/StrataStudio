# Strata Studio

![Strata Studio](docs/images/stratastudio-image.png)

[English](README.md) · [简体中文](README.zh-CN.md)

Strata推論エンジン用のTauri 2 GUIとRust APIゲートウェイです。Apple Silicon向けにビルドし、推論には既存StrataのMetal実装を使用します。

## 起動

```sh
npm ci
npm run desktop
```

アプリが`127.0.0.1:8080`のAPIサーバーを起動します。独立サーバーとの同時起動はできません。

ブラウザーまたはヘッドレスで使用する場合：

```sh
npm run build
cargo run -p studio-server --release
```

`http://127.0.0.1:8080`を開きます。

## 推論エンジンの接続

エンジンパネルにStrataディレクトリ、依存パッケージが入ったPython 3.10以上の絶対パス、Strataセットアップで生成した`strata-*.json`を指定し、「起動」を押します。初回はStrata内の`.venv/bin/python`と既存の設定ファイルを検出します。

モデルなしで接続を検証する場合は「テストエンジン」を選びます。応答とログの速度はmockエンジンの値で、実推論の性能ではありません。

実推論にはMetalエンジンのビルド、モデル、トークナイザーが必要です。[StrataのMac手順](Strata/docs/MAC.md)を参照してください。Studioから巨大モデルを自動ダウンロードすることはありません。32GiBの開発Macでは、Strata標準のSSDストリーミングとメモリ保護を維持します。

パネル右上のアイコンで独立ウインドウに切り離し、同じアイコンで戻せます。独立ウインドウを閉じた場合も元の場所へ戻ります。会話・設定・生成中の文章はRustが所有し、各ウインドウで共有します。会話と設定は再起動後も保存されます。

## APIとビルド

APIパネルの「セッションAPIキー」をコピーし、`Authorization: Bearer`または`x-api-key`で送ります。OpenAIは`/v1/chat/completions`、Anthropicは`/v1/messages`です。キーはアプリ起動ごとに更新されます。

```sh
npm run desktop:build -- --bundles app --no-sign
```

Apple Silicon向けReleaseビルドです。配布時の署名・公証にはAppleの配布用資格情報が必要です。

詳細は[English README](README.md)、[構造](docs/ARCHITECTURE.md)、[ロードマップ](docs/ROADMAP.md)を参照してください。
