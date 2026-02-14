
## Plan: Go-to / Peek 定義 & 参照機能追加

TL;DR — コード ←→ 翻訳（.po 等）間の「Go to Definition / Peek」および「Find References」を実装します。  
方法：L10nService に検索ヘルパーを追加して（キー抽出・翻訳位置検索・コード参照検索）、新しい VS Code プロバイダ `DefinitionProvider` / `ReferenceProvider` を作成し `activate` で登録します。既存のパース/キャッシュ（CodeManager / TranslationManager）を再利用します。結果はユニット＋統合テストで検証します。✅

---

### 変更一覧（最小実装）
1. （済）L10nService.ts — public lookup/utility メソッドを追加
   - `getKeyAtPosition(uri: URI, position: MyPosition): string | null`
   - `findTranslationLocationsForKey(key: string): MyLocation[]`
   - `findCodeReferencesForKey(key: string): MyLocation[]`
   - `findDefinition(uri: URI, position: MyPosition): MyLocation[]`（高レベル：コード→翻訳）
   - `findReferences(uri: URI, position: MyPosition): MyLocation[]`（高レベル：翻訳→コード / キーの全参照）
2. （済）型変換：`MyLocation` → `vscode.Location`
   - `src\models\vscWorkspace.ts` に `toVscLocation(MyLocation): vscode.Location` を追加
3. `src/providers/definitionProvider.ts`（新規）
   - 実装：`vscode.DefinitionProvider`
   - 動作：エディタの位置 → `L10nService` の高レベル API を呼ぶ → `MyLocation[]` を返却
4. `src/providers/referenceProvider.ts`（新規）
   - 実装：`vscode.ReferenceProvider`
   - 動作：エディタの位置 → `L10nService` の高レベル API を呼ぶ → `MyLocation[]` を返却
5. extension.ts — Provider を登録（`l10nService.init()` の後、Diagnostics 登録と同じ位置）
6. テスト
   - ユニット：l10nService.test.ts（新規ケース）
   - ユニット：`src/test/unit/providers/definitionProvider.test.ts`（新規）
   - ユニット：`src/test/unit/providers/referenceProvider.test.ts`（新規）

---

### 実装ステップ（順序つき）
1. `L10nService` に「キー抽出＋検索」API を追加（最優先）
   - 利用先：既存の `CodeManager.codes` / `TranslationManager.l10ns` を走査して結果を集約
   - 挙動：同じキーの複数候補（複数 .po / 複数言語 / 複数使用箇所）はすべて返す
2. 単体テストを追加して API を検証（キーが得られる、.po の位置が返る、コード参照が返る）
3. `DefinitionProvider` を実装
   - `provideDefinition`（コード上の l10n 呼び出し → 翻訳の `msgid` 位置を返す）
   - `provideReferences`（.po 上の `msgid` → コード位置リストを返す）
4. `ReferenceProvider` を実装
   - `provideDefinition`（コード上の l10n 呼び出し → 翻訳の `msgid` 位置を返す）
   - `provideReferences`（.po 上の `msgid` → コード位置リストを返す）
5. `activate` にプロバイダを登録（すでに `l10nService` を初期化している箇所に追加）
6. プロバイダのユニット & 統合テストを実装（fixture に対する実動作確認）
7. ビルド・テスト・手動確認

---

### 重要な設計決定（既定）
- 範囲：コード→翻訳 と 翻訳→コード の両方を実装（ユーザー選択通り）
- 対象：既対応の全コード言語（既存の `CodeLanguages`）および `.po`（デフォルト）
- 結果：すべての一致位置を返す（UI 側で複数候補を選択可能）
- サービス層は `vscode` モジュールを直接使わない（L10nService にロジック、Provider が UI 変換を担当）

---

### 具体的なファイル／シンボル（作業ガイド）
- 変更：L10nService.ts
  - 追加箇所：`getDiagnostics()` の直後にヘルパー群を追加
  - 参照キャッシュ：`this.managers` → 各 `L10nTargetManager.manager` の `codes` / `l10ns` を参照
- 追加：`src/providers/definitionProvider.ts`
  - 登録：extension.ts（`activate` 内、DiagnosticProvider 登録の近傍）
  - DocumentSelectors：既対応言語 + `**/*.po`
- 追加：`src/providers/referenceProvider.ts`
  - 登録：extension.ts（`activate` 内、DiagnosticProvider 登録の近傍）
  - DocumentSelectors：既対応言語 + `**/*.po`
- テスト追加箇所：
  - l10nService.test.ts（ユニット）
  - `src/test/unit/providers/definitionProvider.test.ts`（ユニット）
  - `src/test/unit/providers/referenceProvider.test.ts`（ユニット）
  - `src/test/vscode/l10nDefinition.test.ts`（統合 / 使用 fixture: csharp）

---

### Verification（動作確認）
- 自動テスト
  - `yarn compile`
  - `yarn test:unit`
  - `yarn test:integration`
- 手動確認
  1. ワークスペースを csharp で開く
  2. `chsharp.cs` の l10n 呼び出し上で「Go to Definition」→ `ja.po` の該当 `msgid` が開くこと
  3. `ja.po` の `msgid` 上で「Find All References / Peek References」→ `chsharp.cs` の使用箇所が列挙されること
- 受け入れ基準
  - 追加 API のユニットテストが存在し通ること
  - 統合テストが pass すること
  - 手動で Code→PO, PO→Code が機能すること

---

### リスクと対応策
- 大量ヒット時のパフォーマンス — 必要なら検索結果を上限付きにする（将来的拡張）
- 設定で対象外のフォルダがある場合は `L10nService` 側で設定チェックを行う
- `vscode` 型変換は Provider 側で集中処理（サービスは VSCode 非依存のまま）

---

### 実装優先度（推奨）
1. L10nService の検索ヘルパー追加（必須）  
2. ユニットテスト（L10nService）  
3. Definition/Reference Provider 実装  
4. Provider のユニット + 統合テスト  
5. register in `extension.ts` と最終手動確認
