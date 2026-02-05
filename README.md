# PO .NET

PO .NET is a Visual Studio Code extension that helps with localization in C# source code.

## Features

- When you hover over a localization function, the extension displays the translation from the .po files.
- The hover text includes links and supports F12 (Go to Definition) to jump to the corresponding entry in the .po file.
- You can use Find References (F12) on a .po file entry to jump to the corresponding usages in source code.
- It detects untranslated keys and shows warnings (also displayed in the PROBLEMS tab).
- Provides IntelliSense (completion) to suggest translation keys from .po files.
- Supports per-folder settings via `podotnetconfig.json`.

## Settings

Placing the following configuration file (`podotnetconfig.json`) will affect all `.cs` files under that folder. If you add, change, or remove the configuration file, please restart the extension.

```json
{
  "config": [
    {
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
      "sourceDirs": ["./foo"],
      "poDirs": ["./fooL10N"],
      "localizeFuncs": ["G"]
    },
    {
      "sourceDirs": ["./bar"],
      "poDirs": ["./barL10N"],
      "localizeFuncs": ["G"]
    }
  ]
}
```

- `sourceDirs`: Specifies folders that contain `.cs` files. Subfolders are also included. Use paths relative to the configuration file; `.` is usually sufficient. Specify more precisely if you want the extension to operate only on certain folders.
- `poDirs`: Specifies folders that contain `.po` files. Subfolders are also included. Use paths relative to the configuration file.
- `localizeFuncs`: Specifies the names of localization functions.

---

# 日本語

C# ソースコード上のローカライズを支援する拡張機能です。

## 機能

- ローカライズ関数をホバーすると .po ファイルの翻訳内容を表示する。
- ホバーテキストのリンクまたはF12キー(Go to Definition)から .po ファイルの該当エントリへジャンプする。
- .po ファイルのエントリからF12キー(Go to References)でソースコードの該当箇所へジャンプする。
- 未翻訳キーを検出し警告表示する（PROBLEMS タブにも表示する）。
- インテリセンス（補完機能）で .po ファイルの翻訳キーを補完する。
- フォルダごとの設定が可能（podotnetconfig.json）

## 設定

以下の設定ファイル(`podotnetconfig.json`)を配置すると、そのフォルダ配下のすべての .cs ファイルに影響します。設定ファイルを追加・変更・削除した場合は拡張機能を再起動してください。

```json
{
  "config": [
    {
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
      "sourceDirs": ["./foo"],
      "poDirs": ["./fooL10N"],
      "localizeFuncs": ["G"]
    },
    {
      "sourceDirs": ["./bar"],
      "poDirs": ["./barL10N"],
      "localizeFuncs": ["G"]
    }
  ]
}
```

- `sourceDirs`: .cs ファイルのフォルダを指定します。サブフォルダも対象となります。設定ファイルからの相対パスで指定してください。通常は `.` で十分です。一部のフォルダでのみ機能させたい場合は詳細に指定してください。
- `poDirs`: .po ファイルのフォルダを指定します。サブフォルダも対象となります。設定ファイルからの相対パスで指定してください。
- `localizeFuncs`: ローカライズ関数の名前を指定します。
