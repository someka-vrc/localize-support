# localize-support — VS Code ローカライズ支援 / localization helper

日本語 + English

## 概要

**localize-support** は VS Code 上でソースコードと翻訳ファイル（例: .po）を連携し、翻訳キーの定義ジャンプ／参照／ホバー表示／リネーム／診断などローカライズワークフローを支援する拡張機能です。内部で tree-sitter を使った高速なコード解析と、PO 形式のパース・編集支援を提供します。

## 主な機能

- 定義へジャンプ `F12`: ソース中のロケールキーから翻訳ファイルへ移動
- 参照検索 `Shift+F12`: 翻訳キーが使われている箇所を一覧表示
- ホバー翻訳プレビュー: 翻訳文の即時プレビュー
- リネーム連携 `F2`: 翻訳キー名の変更をコードと翻訳ファイルへ反映
- 診断: 翻訳不足・未使用キーなどの警告表示

## 対応言語と形式

- コード言語: JavaScript, TypeScript, Python, C#
- 翻訳形式: PO ファイル（.po）

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

ワークスペース内で異なるターゲット設定を行いたい場合は、任意のフォルダに `localize-support.json` を配置してください。

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
- `codeDirs`: コードのルートディレクトリ（json ファイルからの相対パス）
- `l10nFormat`: ローカライズファイルの形式（現状は `po` のみ）
- `l10nDirs`: ローカライズファイルのルートディレクトリ（json ファイルからの相対パス）
- `l10nExtension`: ローカライズファイルの拡張子
- `l10nFuncNames`: ローカライズ関数の名前（例: `t("key")` の場合は `"t"`）

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

---

## English

## Overview

**localize-support** is a VS Code extension that connects source code with translation files (for example, `.po`) and helps localization workflows by providing go-to-definition, find references, hover previews, rename integration, and diagnostics. It uses tree-sitter internally for fast code parsing and provides PO parsing and editing support.

## Key features

- Go to definition `F12`: jump from locale keys in code to translation files
- Find references `Shift+F12`: list locations where a translation key is used
- Hover translation preview: instant preview of translated strings
- Rename integration `F2`: propagate locale key name changes to code and translation files
- Diagnostics: warnings for missing translations or unused keys

## Supported languages & formats

- Code languages: JavaScript, TypeScript, Python, C#
- Translation format: PO files (`.po`)

## Usage

Install `localize-support` and configure it.

## Configuration

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

- `codeLanguages`: target code languages (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: root directories for source code (relative to workspace root)
- `l10nFormat`: localization file format (currently `po` only)
- `l10nDirs`: root directories for localization files (relative to workspace root)
- `l10nExtension`: localization file extension
- `l10nFuncNames`: names of localization functions (e.g. for `t("key")`, use `"t"`)
- `localize-support.wasmCdnBaseUrl`: base URL for tree-sitter wasm CDN (use `{version}` placeholder)

To configure different targets within the workspace, place a `localize-support.json` file in the desired folder:

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

- `codeLanguages`: target code languages (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: root directories for source code (relative to the JSON file)
- `l10nFormat`: localization file format (currently `po` only)
- `l10nDirs`: root directories for localization files (relative to the JSON file)
- `l10nExtension`: localization file extension
- `l10nFuncNames`: names of localization functions (e.g. `"t"` for `t("key")`)

## Development & testing

- Build: `yarn compile`
- Dev watch: `yarn watch` (TypeScript watch)
- Lint: `yarn lint`
- Unit tests: `yarn test:unit`
- Integration tests: `yarn test:integration`
- All tests: `yarn test`

## Contributing

1. Open an issue or fork and create a branch
2. Run `yarn lint` and `yarn test:unit`
3. Submit a PR with description and tests

## Troubleshooting

- If wasm download fails, verify `localize-support.wasmCdnBaseUrl`.

## License

MIT

## Release notes

- 0.0.1 — Initial implementation: go-to-definition, references, hover, rename, PO parsing, Tree‑sitter integration

## Feedback

Report bugs or feature requests via GitHub Issues.

