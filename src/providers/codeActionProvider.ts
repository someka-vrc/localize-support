import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";
import { DiagnosticsCode, DiagnosticsCodeType } from "../models/vscodeTypes";
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
   * TODO: 定義されていない翻訳エントリを各言語の翻訳ファイルに追加するクイックフィックスを返す
   * そのドキュメントのそのカーソル位置より手前で一番近いローカライズ関数がありそのキーが
   * 各言語で定義されている場合、そのキーの下に追加する。
   * そうでなければ末尾にエントリを追加する。
   * 追加時の翻訳文字列はキーと同じ文字列で良い。
   * → l10nServiceに、挿入位置と挿入文字列を返す関数が必要（詳しい処理は各翻訳パーサーに任せる＆未実装ならnullを返しアクション追加しない）
   * @param diag 
   * @param doc 
   * @returns 
   */
  undefinedKeyAction: ActionFactory = (diag, doc) => {
    return [];
  };
  /**
   * TODO: コード側で使用されていないエントリを各言語の翻訳ファイルから削除するクイックフィックスを返す
   * →削除に必要な情報を返す関数がl10nServiceに必要（未実装ならnullを返しアクション追加しない）
   * @param diag 
   * @param doc 
   * @returns 
   */
  unusedKeyAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
  missingTranslationAction: ActionFactory = (diag, doc) => {
    // no actions
    return [];
  };
}
