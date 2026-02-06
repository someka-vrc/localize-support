# PO Support

PO Support is a Visual Studio Code extension that helps with localization in C# source code.

## Features

- Command `Create podotnetconfig.json`: Creates a `podotnetconfig.json` file in the folder of the currently edited file.
- Command `Reload PO data (clear cache)`: Clears the PO data cache and reloads it.
- Hover: Displays the translation from .po files on the arguments of localization functions and shows links to the corresponding entries.
- Completion: Provides completion for msgid candidates in the first string argument of localization functions, displaying translation previews.
- Go to Definition: Jumps to the msgid definition (within .po files).
- Find References: Finds usages in source code from msgid in .po files.
- Rename (F2): Renames msgid in C# source or .po files, updating .po and references in source code.

## Settings

Placing the following configuration file (`podotnetconfig.json`) will affect all `.cs` files under that folder. If you add, change, or remove the configuration file, please restart the extension or run `Reload PO data` command.

```json
{
  "config": [
    {
      "languages": ["csharp"],
      "sourceDirs": ["."],
      "poDirs": ["./L10N"],
      "localizeFuncs": ["G"]
    }
  ]
}
```

You can also define the settings via **Settings (UI / settings.json)** using the key `poDotnet.config`. This setting can coexist with `podotnetconfig.json`, and both will be applied.

Example (`settings.json`):
```json
{
  "poDotnet.config": [
    {
      "languages": ["csharp"],
      "sourceDirs": ["./foo"],
      "poDirs": ["./fooL10N"],
      "localizeFuncs": ["G"]
    },
    {
      "languages": ["csharp"],
      "sourceDirs": ["./bar"],
      "poDirs": ["./barL10N"],
      "localizeFuncs": ["G"]
    }
  ], 
  "poDotnet.wasmCdnBaseURL": "https://unpkg.com/tree-sitter-wasms@latest/out/"
}
```

- `languages`: Specifies the programming languages.
- `sourceDirs`: Specifies folders that contain `.cs` files. Subfolders are also included. Use paths relative to the configuration file; `.` is usually sufficient. Specify more precisely if you want the extension to operate only on certain folders.
- `poDirs`: Specifies folders that contain `.po` files. Subfolders are also included. Use paths relative to the configuration file.
- `localizeFuncs`: Specifies the names of localization functions.
- `wasmCdnBaseURL`: Settings only. Optional setting to control where tree-sitter wasm files are fetched from. By default, it uses unpkg.

---

# 日本語

C# ソースコード上のローカライズを支援する拡張機能です。

## 機能

- コマンド `Create podotnetconfig.json`: 編集中ファイルのフォルダに `podotnetconfig.json` を作成する。
- コマンド `Reload PO data (clear cache)`: PO データのキャッシュをクリアして再読み込みする。
- ホバー: ローカライズ関数の引数上で `.po` の翻訳を表示し、該当エントリへのリンクを表示する。
- 補完: ローカライズ関数の最初の文字列引数で `msgid` 候補を補完し、翻訳プレビューを表示する。
- 定義へ移動（Go to Definition）: `msgid` の定義（`.po` 内）へジャンプする。
- 参照の検索（Find References）: `.po` の `msgid` からソース内の使用箇所を検索する。
- リネーム（F2）: C# ソースまたは `.po` 上で `msgid` をリネームすると、`.po` とソース中の参照を更新する。

## 設定

以下の設定ファイル(`podotnetconfig.json`)を配置すると、そのフォルダ配下のすべての .cs ファイルに影響します。設定ファイルを追加・変更・削除した場合は拡張機能を再起動するか、`Reload PO data` コマンドを実行してください。

```json
{
  "config": [
    {
      "languages": ["csharp"],
      "sourceDirs": ["."],
      "poDirs": ["./L10N"],
      "localizeFuncs": ["G"]
    }
  ]
}
```

また、設定は **Settings（UI / settings.json）** でも定義できます。設定キーは `poDotnet.config` です。この設定と `podotnetconfig.json` は共存可能で、両方の設定が適用されます。

例（settings.json）:
```json
{
  "poDotnet.config": [
    {
      "languages": ["csharp"],
      "sourceDirs": ["./foo"],
      "poDirs": ["./fooL10N"],
      "localizeFuncs": ["G"]
    },
    {
      "languages": ["csharp"],
      "sourceDirs": ["./bar"],
      "poDirs": ["./barL10N"],
      "localizeFuncs": ["G"]
    }
  ], 
  "poDotnet.wasmCdnBaseURL": "https://unpkg.com/tree-sitter-wasms@latest/out/"
}
```

- `languages`: プログラミング言語を指定します。
- `sourceDirs`: .cs ファイルのフォルダを指定します。サブフォルダも対象となります。設定ファイルからの相対パスで指定してください。通常は `.` で十分です。一部のフォルダでのみ機能させたい場合は詳細に指定してください。
- `poDirs`: .po ファイルのフォルダを指定します。サブフォルダも対象となります。設定ファイルからの相対パスで指定してください。
- `localizeFuncs`: ローカライズ関数の名前を指定します。
- `wasmCdnBaseURL`: Settings のみ。オプション設定で、tree-sitter wasm ファイルの取得元を制御します。デフォルトでは unpkg を使用します。
