## 会話ルール

- ユーザーに対しては日本語で話すこと（独り言は英語でも可）。

## コード変更後にやってほしいこと

- ワークスペースエラーの確認と修正
- `yarn compile` の実行。リントエラーとコンパイルエラーがあれば修正すること。

## 実装

- テスタビリティを意識して、責任分離・関心事の分離を適切に行うこと。
- 原則として require を使用しないこと
- テスタビリティのため、 `vscode` モジュールを直接使用しないこと。 `VSCodeWorkspaceService` を注入して使用すること。（必要な機能が `VSCodeWorkspaceService` にない場合は追加実装してください）

### フォルダ構成

- `src/models/` - データモデル関連のコード
- `src/services/` - ビジネスロジックとデータ操作。 `src\services\l10nService.ts` がコアのサービスです。
- `src/providers/` - VSCode API のプロバイダ
- `src/test/unit` - vscode インスタンスを必要としない、vscode モジュールを使うとしてもモックで対応可能な軽量な単体テスト
- `src/test/vscode` - vscode インスタンスを必要とするテスト、統合テスト

### テスト

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。代替方法を下記で説明していますのでよく読んでください。

#### 単体テスト

`yarn test:unit` コマンドで実行します。テストフレームワークには mocha (ui: tdd) を使用します。

単体テストでは vscode インスタンスは使用不可です(mocha で実行するため)。 vscode モジュールのコアな機能をテストしたければ統合テストで行ってください。
しかし軽量な処理であればモックを用いて高速な単体テストが実装できます。 `src/test/unit/mocks/mockWorkspaceService.ts` に基本形が用意されていますので、プロパティを sinon で上書きして使うか個別に実装してください。

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。その代わりに `fixtures/workspaces/unit/{subPath}/{testName}` フォルダを作成して以下のように `unitTestHelper` を使用してください。これを使うとテスト時にフィクスチャフォルダを一時コピーしオリジナルに触れないので、汚れることがありません。

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

#### vscode インスタンスを必要とするテスト、統合テスト

`yarn test:integration` コマンドで実行します。テストフレームワークには mocha (ui: tdd) を使用します。

ファイル参照や書き込みを伴うテストでは、テストレビューのしやすさの観点から、OSの一時フォルダやインメモリは使用禁止です。その代わりに `fixtures/workspaces/vscode/{テストファイル名(test.ts抜き)}` フォルダを作成してください。テスト実行時にそのフォルダのコピーがワークスペースとして開かれます。ただテストランナーの都合でカレントディレクトリは開発ワークスペースと異なるため注意してください。 `src/test/vscode/extension.test.ts` の `Fixture Test` スイートを参考にしてください。

統合テストのチェック事項:

- OSの一時ファイルやインメモリを使用していないこと
- カレントディレクトリを開発プロジェクトルート(`localize-support/`)と混同していないこと
