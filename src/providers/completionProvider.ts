import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";

const MAX_RESULTS = 200;

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class CompletionProvider implements vscode.CompletionItemProvider {
  constructor(private l10nService: L10nService) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    // quick lightweight check: ensure we are inside a localization function's string arg
    const funcNames = this.l10nService.getAllFuncNames();
    if (!funcNames || funcNames.length === 0) {
      return null;
    }

    const line = document.lineAt(position.line).text;
    const lineUpToCursor = line.slice(0, position.character);

    // find nearest opening quote before cursor
    const lastSingle = lineUpToCursor.lastIndexOf("'");
    const lastDouble = lineUpToCursor.lastIndexOf('"');
    const lastBack = lineUpToCursor.lastIndexOf("`");
    const openQuoteIdx = Math.max(lastSingle, lastDouble, lastBack);
    if (openQuoteIdx === -1) {
      return null;
    }
    const quoteChar = lineUpToCursor[openQuoteIdx];

    // very small heuristic: ensure the opening quote is part of a function call for one of funcNames
    const beforeQuote = lineUpToCursor.slice(0, openQuoteIdx);
    const parenIdx = beforeQuote.lastIndexOf("(");
    if (parenIdx === -1) {
      return null;
    }
    const beforeParen = beforeQuote.slice(0, parenIdx);
    const funcRegex = new RegExp(`(${funcNames.map(escapeForRegex).join("|")})\\s*$`);
    if (!funcRegex.test(beforeParen)) {
      return null;
    }

    // compute current prefix (string content between opening quote and cursor)
    const prefix = line.slice(openQuoteIdx + 1, position.character);

    // replacement range: from after opening quote to either the closing quote (if present on the line)
    const afterCursor = line.slice(position.character);
    const closingIdxInRemainder = afterCursor.indexOf(quoteChar);
    const endReplaceCol = closingIdxInRemainder === -1 ? position.character : position.character + closingIdxInRemainder;
    const replaceRange = new vscode.Range(position.line, openQuoteIdx + 1, position.line, endReplaceCol);

    const candidates = this.l10nService.getCompletionCandidates(prefix, MAX_RESULTS);
    if (!candidates || candidates.length === 0) { return null; }

    const items: vscode.CompletionItem[] = [];
    for (const c of candidates) {
      const k = c.key;
      const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Value);
      item.sortText = String(999999 - Math.floor(c.score)).padStart(6, "0") + k;

      const trans = c.translations || [];
      item.detail = trans.length > 0 ? `${trans[0].translation}` : "(no translation)";
      if (trans.length > 0) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown("Translations:\n");
        for (const t of trans.slice(0, 5)) {
          md.appendMarkdown(`- **${t.lang}**: ${t.translation}\n`);
        }
        item.documentation = md;
      }

      item.insertText = k;
      item.range = replaceRange;
      items.push(item);
    }

    return new vscode.CompletionList(items, true);
  }
}
