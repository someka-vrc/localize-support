# localize-support — VS Code ローカライズ支援

## 概要

**localize-support** は VS Code 上でソースコードと翻訳ファイル（例: .po）を連携し、翻訳キーの定義ジャンプ／参照／ホバー表示／リネーム／診断などローカライズワークフローを支援する拡張機能です。内部で tree-sitter を使った高速なコード解析と、PO 形式のパース・編集支援を提供します。

## 対応言語と形式

- コード言語: JavaScript, TypeScript, Python, C#
- 翻訳形式: GNU Gettext PO ファイル（.po）

## 主な機能

- 定義へジャンプ `F12`: ソース中のロケールキーから翻訳ファイルへ移動
- 参照検索 `Shift+F12`: 翻訳キーが使われている箇所を一覧表示
- ホバー翻訳プレビュー: 翻訳文の即時プレビュー
- 補完 `Ctrl+Space`: ローカライズ関数の引数内で既存のキー候補と翻訳プレビューを表示
- リネーム連携 `F2`: 翻訳キー名の変更をコードと翻訳ファイルへ反映
- 診断: 翻訳不足・未使用キーなどの警告表示

## 使い方

`localize-support` をインストールし、設定してください。

## 設定

`settings.json`: 

```json
{
  "localize-support.targets": [
    {
      "codeLanguages": ["javascript", "typescript"],
      "codeDirs": ["src"],
      "l10nFormat": "po",
      "l10nDirs": ["locales"],
      "l10nExtension": ".po",
      "l10nFuncNames": ["t", "_"]
    }
  ],
  "localize-support.wasmCdnBaseUrl": "https://unpkg.com/tree-sitter-wasms@{version}/out/"
}
```

- `codeLanguages`: 対象のコード言語 (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: コードのルートディレクトリ（ワークスペースルートからの相対パス）
- `l10nFormat`: ローカライズファイルの形式（現状は `po` のみ）
- `l10nDirs`: ローカライズファイルのルートディレクトリ（ワークスペースルートからの相対パス）
- `l10nExtension`: ローカライズファイルの拡張子
- `l10nFuncNames`: ローカライズ関数の名前（例: `t("key")` の場合は `"t"`）
- `localize-support.wasmCdnBaseUrl` — tree-sitter wasm の CDN ベース URL（`{version}` プレースホルダを使用してください）

ターゲット設定は、任意のフォルダの `localize-support.json` でも行うことが出来ます。

```json
{
  "targets": [
    {
      "codeLanguages": ["javascript", "typescript"],
      "codeDirs": ["src"],
      "l10nFormat": "po",
      "l10nDirs": ["locales"],
      "l10nExtension": ".po",
      "l10nFuncNames": ["t", "_"]
    }
  ]
}
```

- `codeLanguages`: 対象のコード言語 (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: コードのルートディレクトリ（`localize-support.json` のあるフォルダを基準とした相対パス。隣接する `src` は `./src` または `src` と指定します）
- `l10nFormat`: ローカライズファイルの形式（現状は `po` のみ）
- `l10nDirs`: ローカライズファイルのルートディレクトリ（`localize-support.json` のあるフォルダを基準とした相対パス。隣接する `locales` は `./locales` または `locales` と指定します）
- `l10nExtension`: ローカライズファイルの拡張子
- `l10nFuncNames`: ローカライズ関数の名前（例: `t("key")` の場合は `"t"`）

## コマンド

- `Localize Support: Toggle diagnostics` — 診断表示のオンオフを切り替えます。翻訳不足や未使用キーなどの警告表示を制御します。

## 開発・テスト

- ビルド: `yarn compile`
- 開発ウォッチ: `yarn watch` (TypeScript の watch)
- Lint: `yarn lint`
- 単体テスト: `yarn test:unit`
- 統合テスト: `yarn test:integration`
- 全テスト: `yarn test`

## 貢献

1. Issue を立てるか、Fork → ブランチを作成
2. `yarn lint` と `yarn test:unit` を通す
3. PR を送付（変更点の説明とテストを添えてください）

## トラブルシューティング

- wasm のダウンロードで失敗する場合は `localize-support.wasmCdnBaseUrl` を検証してください。

## LICENSE

MIT

## リリースノート

- 0.0.1 — 初期実装: 定義ジャンプ、参照、ホバー、リネーム、PO パース、Tree‑sitter 連携

## フィードバック

不具合・要望は GitHub Issues で報告してください。
