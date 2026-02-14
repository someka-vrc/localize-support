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

    const allKeys = this.l10nService.getAllKeys() || [];
    const lower = prefix.toLowerCase();

    // fuzzy subsequence scoring: returns -Infinity for no match, higher is better
    const fuzzyScore = (pat: string, str: string): number => {
      if (!pat) return 1000; // empty pattern — highest score
      pat = pat.toLowerCase();
      str = str.toLowerCase();
      let pi = 0;
      let si = 0;
      let score = 0;
      let consec = 0;
      let firstMatch = -1;
      while (pi < pat.length && si < str.length) {
        if (pat[pi] === str[si]) {
          if (firstMatch === -1) firstMatch = si;
          // base match bonus
          score += 100;
          // consecutive bonus
          if (consec > 0) score += 30 * consec;
          // prefix bonus
          if (si === 0) score += 50;
          consec += 1;
          pi += 1;
          si += 1;
        } else {
          consec = 0;
          si += 1;
        }
      }
      if (pi < pat.length) return -Infinity; // not a subsequence
      // penalize late first match and long candidate length
      const gapPenalty = firstMatch >= 0 ? firstMatch : 0;
      const lengthPenalty = Math.max(0, str.length - pat.length);
      return score - gapPenalty - Math.floor(lengthPenalty / 2);
    };

    const scored: { key: string; score: number }[] = [];
    for (const k of allKeys) {
      const s = fuzzyScore(lower, k);
      if (s !== -Infinity) scored.push({ key: k, score: s });
    }

    if (scored.length === 0) return null;

    // sort by score desc, then label asc
    scored.sort((a, b) => (b.score - a.score) || a.key.localeCompare(b.key));
    const candidates = scored.slice(0, MAX_RESULTS).map((s) => s.key);

    const items: vscode.CompletionItem[] = [];
    for (const k of candidates) {
      const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Value);
      // sortText derived from score to preserve ordering in editor
      const sc = scored.find((x) => x.key === k)?.score ?? 0;
      // pad score so string ordering works (negate so high scores come first)
      item.sortText = String(999999 - Math.floor(sc)).padStart(6, "0") + k;

      // preview/detail from translations
      const trans = this.l10nService.getTranslationsForKey(k) || [];
      item.detail = trans.length > 0 ? `${trans[0].translation}` : "(no translation)";
      if (trans.length > 0) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown("Translations:\n");
        for (const t of trans.slice(0, 5)) {
          md.appendMarkdown(`- **${t.lang}**: ${t.translation}\n`);
        }
        item.documentation = md;
      }

      // ensure only inner-string content is replaced
      item.textEdit = vscode.TextEdit.replace(replaceRange, k);
      items.push(item);
    }

    return new vscode.CompletionList(items, true);
  }
}
