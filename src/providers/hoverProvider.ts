import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";

/**
 * ローカライズキーの上にマウスを置いたとき翻訳プレビューを表示する HoverProvider。
 * `L10nService` から翻訳エントリを取得し、Markdown でレンダリングする。
 */
export class HoverProvider implements vscode.HoverProvider {
  constructor(private l10nService: L10nService) {} 

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const myPos = { line: position.line, character: position.character } as any;
    const key = this.l10nService.getKeyAtPosition(document.uri as any, myPos);
    if (!key) {
      return null;
    }

    const items = this.l10nService.getTranslationsForKey(key) || [];
    if (!items || items.length === 0) {
      return null;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown("localize-support:\n");
    for (const it of items) {
      md.appendMarkdown("- ");
      md.appendText(it.translation || "");
      const payload = { uri: (it.uri as any).toString(), location: it.location };
      const arg = encodeURIComponent(JSON.stringify([payload]));
      md.appendMarkdown(` [${it.fileName}](command:localize-support.openLocation?${arg})\n`);
    }
    return new vscode.Hover(md);
  }
}
