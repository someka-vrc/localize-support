## 会話ルール

- ユーザーに対しては日本語で話すこと（独り言は英語でも可）。

## コード変更後にやってほしいこと

- ワークスペースエラーの確認と修正
- `yarn compile` の実行。リントエラーとコンパイルエラーがあれば修正すること。

## 実装

- テスタビリティを意識して、責任分離・関心事の分離を適切に行うこと。
- `require` と `await import` は ESLint ルールで禁止されているため、使用しないこと。どうしても必要な場合はユーザーに承認を得ること。
- `vscode` モジュール依存とビジネスロジックを分離するため、以下のファイル以外での `vscode` モジュールの直接使用は ESLint ルールで禁止されています。代わりに `src\models\vscodeTypes.ts` で定義されたラッパーを注入して使用してください。（必要な機能がラッパーに存在しない場合は追加実装してください）
   - `src/providers/**`
   - `src/commands/**`
   - `src/extension.ts`
   - `src/models/vscode*.ts`
   - 単体テスト

### フォルダ構成

- `fixtures/` - テスト用フィクスチャ(後述)
- `src/commands/` - VSCode コマンドの実装
- `src/extension.ts` - エクステンションのエントリーポイント
- `src/models/` - データモデル関連のコード
- `src/providers/` - VSCode API のプロバイダ
- `src/services/` - ビジネスロジックとデータ操作。 `src/services/l10nService.ts` がコアのサービスです。
- `src/test/unit` - 単体テスト(後述)
- `src/test/vscode` - 統合テスト(後述)
- `src/utils/` - ユーティリティ関数
- `schemas/` - JSON スキーマファイル

## コマンド実行

テストやコンパイル等のコマンドは基本的に `package.json` のスクリプトを使用し、余計なオプションを付けないでください。例えば `yarn test:unit` とだけ入力して実行してください。オプションを付けるとテストランナーの挙動が変わり、テストが失敗する可能性があります。

## テスト

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。代替方法を下記で説明していますのでよく読んでください。

### フォルダ構成

- `fixtures/` - テスト用フィクスチャ
  - `workspaces/` - ワークスペース関連のフィクスチャ
    - `unit/{任意の名前}` - 単体テスト用のフィクスチャ
    - `vscode/{任意の名前}` - 統合テスト用のフィクスチャ
- `src/test/unit` - vscode インスタンスを必要としない軽量な単体テスト
- `src/test/vscode` - vscode インスタンスを必要とするテストと統合テスト(以下、まとめて統合テストと呼びます)

### 単体テスト

ビジネスロジックおよび一部モデルのコードは、vscode インスタンスを必要としない軽量な単体テストでカバーしてください。

`yarn test:unit` コマンドで実行します。テストフレームワークには mocha (ui: tdd) を使用します。

単体テストでは vscode インスタンスは使用不可です(mocha で実行するため)。 `vscode` モジュールのコアな機能をテストしたければ統合テストで行ってください。
しかし軽量な処理であればモックを用いて高速な単体テストが実装できます。 `src/test/unit/mocks/mockVscodeWrapper.ts` に基本形が用意されていますので、プロパティを sinon でスタブして使ってください。スタブし忘れた場合は例外が発生します。

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。その代わりに `fixtures/workspaces/unit/{subPath}/{testName}` フォルダを作成して以下のように `unitTestHelper` を使用してください。これを使うとテスト時にフィクスチャフォルダを一時コピーしオリジナルを汚さずにテストできます。

```ts
import { copyWorkspaceIfExists, type DisposablePath } from './unitTestHelper';
suite('foo test', () => {
  let workspace: DisposablePath;

  setup(async () => {
    // 引数： `src/test/bar/foo.test.ts` の場合 `bar/foo`
    workspace = await copyWorkspaceIfExists('bar/foo');
  });

  teardown(async () => {
    await workspace.dispose();
  });

  test('should do something', async () => {
    const dir = workspace.path;
    // ... テストコード ...
  });
});
```

単体テストのチェック事項:

- OSの一時ファイルやインメモリを使用していないこと
- vscode インスタンスを使用していないこと

#### テストカバレッジ

単体テストを実行するとカバレッジレポートが生成されます。指示された際は参照してください。

- `coverage\coverage-summary.json`: ファイルレベルのカバレッジサマリーを確認したい場合はまずこちらを参照してください。
- lcov, html レポート: より詳細な情報が手に入りますが、ファイルが大きく複雑です。必要なときだけ参照してください。

### vscode 統合テスト

コマンド、プロバイダ、一部モデル(vscode モジュールとの型変換)の実装は vscode インスタンスを必要とするため、統合テストでカバーしてください。統合テストでは実際に vscode インスタンスが起動し、コマンドやプロバイダの実装が正しく動作するかを確認します。

`yarn test:integration` コマンドで実行します。テストフレームワークには mocha (ui: tdd) を使用します。

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。その代わりに `fixtures/workspaces/vscode/{テストファイル名(test.ts抜き)}` フォルダを作成してください。テスト実行時にそのフォルダのコピーがワークスペースとして開かれますので、オリジナルを汚さずにテストを繰り返すことが出来ます。なお、テストランナーの都合でカレントディレクトリは開発ワークスペースと異なるため注意してください。 `src/test/vscode/extension.test.ts` の `Fixture Test` スイートを参考にしてください。

統合テストのチェック事項:

- OSの一時ファイルやインメモリを使用していないこと
- カレントディレクトリを開発プロジェクトルート(`localize-support/`)と混同していないこと
