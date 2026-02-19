import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";
import { DiagnosticsCode, DiagnosticsCodeType } from "../models/vscodeTypes";
import { toVscRange, toVscUri } from "../models/vscodeTypeConverter";
type ActionFactory = (diag: vscode.Diagnostic, doc: vscode.TextDocument) => vscode.CodeAction[];
/**
 * CodeActionProvider
 *
 * 診断に `code` が付与されている場合にプレースホルダーの QuickFix を返す。
 */
export class CodeActionProvider implements vscode.CodeActionProvider {
  /** 各コード向けのアクション */
  private actionFactories: Map<DiagnosticsCodeType, ActionFactory>;

  constructor(private l10nService?: L10nService) {
    this.actionFactories = new Map([
      [DiagnosticsCode.settingsInvalid, this.settingsInvalidAction],
      [DiagnosticsCode.poMissingMsgstr, this.poMissingMsgstrAction],
      [DiagnosticsCode.poEmptyMsgstr, this.poEmptyMsgstrAction],
      [DiagnosticsCode.poDuplicateMsgid, this.poDuplicateMsgidAction],
      [DiagnosticsCode.poInvalidMsgidFormat, this.poInvalidMsgidFormatAction],
      [DiagnosticsCode.poInvalidMsgstrFormat, this.poInvalidMsgstrFormatAction],
      [DiagnosticsCode.poUnexpectedContinuation, this.poUnexpectedContinuationAction],
      [DiagnosticsCode.poUnrecognizedLine, this.poUnrecognizedLineAction],
      [DiagnosticsCode.poParseError, this.poParseErrorAction],
      [DiagnosticsCode.undefinedKey, this.undefinedKeyAction],
      [DiagnosticsCode.unusedKey, this.unusedKeyAction],
      [DiagnosticsCode.missingTranslation, this.missingTranslationAction],
    ]);
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      const code = diag.code; // vscode.Diagnostic の code

      if (!this.isDiagnosticsCode(code)) {
        continue;
      }

      const factory = this.actionFactories.get(code);
      if (factory) {
        const acts = factory(diag, document) || [];
        for (const a of acts) {
          a.diagnostics = [diag];
          actions.push(a);
        }
        continue;
      }
    }

    return actions;
  }

  isDiagnosticsCode(value: any): value is DiagnosticsCodeType {
    return Object.values(DiagnosticsCode).includes(value);
  }

  settingsInvalidAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poMissingMsgstrAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poEmptyMsgstrAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poDuplicateMsgidAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poInvalidMsgidFormatAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poInvalidMsgstrFormatAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poUnexpectedContinuationAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poUnrecognizedLineAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  poParseErrorAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  /**
   * 定義されていない翻訳エントリを各言語の翻訳ファイルに追加するクイックフィックスを返す
   * - 既にそのファイルに存在する場合はスキップする
   * - 初期 msgstr はキーと同じ文字列を入れる
   * - 翻訳ファイル一覧は `L10nService.getAllL10nUris()` から取得する（存在しない場合は例外）
   */
  undefinedKeyAction: ActionFactory = (diag, doc) => {
    if (!this.l10nService) {
      return [];
    }

    // try to obtain the key at diagnostic position (works for code locations)
    const myPos = { line: diag.range.start.line, character: diag.range.start.character } as any;
    const key =
      (this.l10nService.getKeyAtPosition(doc.uri as any, myPos) as string) ||
      // fallback: extract quoted key from diagnostic message when possible
      (typeof diag.message === "string" ? (diag.message.match(/'([^']+)'/) || [])[1] : null);
    if (!key) {
      return [];
    }

    const l10nUris = this.l10nService.getAllL10nUris();
    if (!l10nUris || l10nUris.length === 0) {
      throw new Error("No localization files found to add the key.");
    }

    // Determine existing entries so we don't duplicate in files that already contain the key
    const existingEntries = this.l10nService.findTranslationEntriesForKey(key) || [];
    const existingPaths = new Set<string>(existingEntries.map((e) => (e.location.uri as any).path));

    const edit = new vscode.WorkspaceEdit();

    // ask service for recommended insertion positions per translation file
    // debug: log diagnostic position and key
    try { console.log(`undefinedKeyAction: doc=${(doc.uri as any).path} diagPos=${myPos.line},${myPos.character} key=${key}`); } catch (err) {}

    const targets = this.l10nService.computeInsertionTargetsForKeyAt(doc.uri as any, myPos, key, key) || [];

    for (const t of targets) {
      const path = (t.uri as any).path;
      if (existingPaths.has(path)) {
        continue; // already present in this file
      }
      const vscUri = toVscUri(t.uri as any);
      const pos = new vscode.Position(t.position.line, t.position.character || 0);
      // parsed.entryText already contains formatting and trailing blank line
      edit.insert(vscUri, pos, t.entryText);
    }

    const action = new vscode.CodeAction(
      `Localize Support: Add localization key '${key}' to translation files`,
      vscode.CodeActionKind.QuickFix,
    );
    action.edit = edit;
    action.isPreferred = true;
    return [action];
  };

  /**
   * コード側で使用されていないエントリを各言語の翻訳ファイルから削除するクイックフィックスを返す
   * - 現在のファイルから削除するアクションと、すべての翻訳ファイルから削除するアクションを返す
   */
  unusedKeyAction: ActionFactory = (diag, doc) => {
    if (!this.l10nService) {
      return [];
    }

    // key is expected to be at the diagnostic position inside the translation file
    const myPos = { line: diag.range.start.line, character: diag.range.start.character } as any;
    const key =
      (this.l10nService.getKeyAtPosition(doc.uri as any, myPos) as string) ||
      (typeof diag.message === "string" ? (diag.message.match(/'([^']+)'/) || [])[1] : null);
    if (!key) {
      return [];
    }

    const entries = this.l10nService.findTranslationEntriesForKey(key) || [];
    if (entries.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // 1) remove from this file only (if present)
    const editThis = new vscode.WorkspaceEdit();
    for (const e of entries) {
      const path = (e.location.uri as any).path;
      if (path === (doc.uri as any).path && e.deletionRange) {
        editThis.delete(toVscUri(e.location.uri as any), toVscRange(e.deletionRange));
      }
    }
    if ((editThis as any).size > 0) {
      const a = new vscode.CodeAction(
        `Localize Support: Remove unused localization key '${key}' from this file`,
        vscode.CodeActionKind.QuickFix,
      );
      a.edit = editThis;
      actions.push(a);
    }

    // 2) remove from all translation files where it exists
    const editAll = new vscode.WorkspaceEdit();
    for (const e of entries) {
      if (e.deletionRange) {
        editAll.delete(toVscUri(e.location.uri as any), toVscRange(e.deletionRange));
      }
    }
    if ((editAll as any).size > 0) {
      const aAll = new vscode.CodeAction(
        `Localize Support: Remove unused localization key '${key}' from all translation files`,
        vscode.CodeActionKind.QuickFix,
      );
      aAll.edit = editAll;
      actions.push(aAll);
    }

    return actions;
  };
  missingTranslationAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
}
