import * as vscode from "vscode";
import * as path from "path";
import { LocalizationService } from "../services/localizationService";
import { POService } from "../services/poService";
import { isInComment } from "../utils";

function escapeForCSharpLiteral(s: string, verbatim: boolean) {
  if (verbatim) {
    return s.replace(/"/g, '""');
  }
  return s.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
}

export function registerCompletionProvider(
  context: vscode.ExtensionContext,
  localizationService: LocalizationService,
  poService: POService,
) {
  return vscode.languages.registerCompletionItemProvider(
    "csharp",
    {
      async provideCompletionItems(document, position, token, completionContext) {
        const text = document.getText();
        const offset = document.offsetAt(position);

        if (isInComment(text, offset)) {
          return undefined;
        }

        // detect if we're inside first string argument of a localization function
        let i = offset - 1;
        let quoteIndex = -1;
        let verbatim = false;
        while (i >= 0) {
          const ch = text[i];
          if (ch === '"') {
            if (i - 1 >= 0 && text[i - 1] === '@') {
              verbatim = true;
              quoteIndex = i;
              break;
            }
            if (i - 1 >= 0 && text[i - 1] === '\\') {
              i -= 2;
              continue;
            }
            quoteIndex = i;
            break;
          }
          i--;
        }
        if (quoteIndex === -1) {
          return undefined;
        }

        // ensure there is no comma between '(' and the quote (i.e., first argument)
        let parenIndex = -1;
        i = quoteIndex - 1;
        let depth = 0;
        while (i >= 0) {
          const ch = text[i];
          if (ch === ')') {
            depth++;
          } else if (ch === '(') {
            if (depth === 0) {
              parenIndex = i;
              break;
            }
            depth--;
          }
          i--;
        }
        if (parenIndex === -1) {
          return undefined;
        }

        const between = text.substring(parenIndex + 1, quoteIndex);
        if (between.indexOf(',') !== -1) {
          return undefined; // not first argument
        }

        let j = parenIndex - 1;
        while (j >= 0 && /\s/.test(text[j])) {
          j--;
        }
        if (j < 0) {
          return undefined;
        }
        const end = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(text[j])) {
          j--;
        }
        const start = j + 1;
        const funcName = text.substring(start, end);
        if (!funcName) {
          return undefined;
        }

        const infos = await localizationService.getAllowedPoDirsForDocument(document);
        if (infos.length === 0) {
          return undefined;
        }
        const docPath = document.uri.fsPath;
        // determine allowed funcs
        const funcsSet = new Set<string>();
        for (const c of infos) {
          // we don't have localizeFuncs here; fall back to 'G'
          // (the old implementation used collectConfigObjectsForDocument to get funcs)
        }
        const funcs = ["G"]; // keep compatibility for now
        if (!funcs.includes(funcName)) {
          return undefined;
        }

        // ensure PO dirs watched
        for (const c of infos) {
          await poService.ensureDirs(c.poDirs, c.workspaceFolder);
        }
        const allowedPoDirs = Array.from(new Set(infos.flatMap((c) => c.poDirs)));

        const prefixRaw = text.substring(quoteIndex + 1, offset);

        const msgids = poService.getAllMsgids(allowedPoDirs);
        if (!msgids || msgids.size === 0) {
          return undefined;
        }

        function fuzzyScore(prefix: string, target: string): number | null {
          if (prefix.length === 0) {
            return 10000 - target.length;
          }
          let ti = 0;
          const positions: number[] = [];
          for (let pi = 0; pi < prefix.length; pi++) {
            const ch = prefix[pi];
            ti = target.indexOf(ch, ti);
            if (ti === -1) {
              return null;
            }
            positions.push(ti);
            ti++;
          }
          const startPos = positions[0];
          const endPos = positions[positions.length - 1];
          const contiguity = endPos - startPos + 1 - prefix.length;
          const score = 10000 - startPos * 100 - contiguity * 20 - (target.length - prefix.length);
          return score;
        }

        const lowerPrefix = prefixRaw.toLowerCase();
        const scored: Array<{ item: vscode.CompletionItem; score: number }> = [];
        for (const id of Array.from(msgids)) {
          const lowerId = id.toLowerCase();
          const score = fuzzyScore(lowerPrefix, lowerId);
          if (score === null) {
            continue;
          }
          const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Text);
          const trans = poService.getTranslations(id, allowedPoDirs);
          if (trans && trans.length > 0) {
            const parts: string[] = [];
            const md = new vscode.MarkdownString("", true);
            md.isTrusted = true;
            md.appendMarkdown("po-dotnet\n\n");
            for (const t of trans) {
              const fileName = path.basename(t.relativePath);
              let message = t.translation.replace(/`/g, "'").replace(/\r?\n/g, " ").trim();
              if (message.length > 160) {
                message = message.slice(0, 159) + "…";
              }
              const fileLink = `[${fileName}](command:po-dotnet.openPoEntry?${encodeURIComponent(JSON.stringify([t.uri.toString(), t.line]))})`;
              md.appendMarkdown(`- ${fileLink}: \`${message}\``);
              parts.push(`(${fileName}) ${message}`);
            }
            item.detail = parts[0] || undefined;
            item.documentation = md;
          }
          const escaped = escapeForCSharpLiteral(id, verbatim);
          item.insertText = escaped;
          const startPos = document.positionAt(quoteIndex + 1);
          const endPos = position;
          (item as any).range = new vscode.Range(startPos, endPos);
          (item as any).sortText = String(10000000 - Math.max(0, Math.floor(score)));
          scored.push({ item, score });
        }

        if (scored.length === 0) {
          return undefined;
        }

        scored.sort((a, b) => b.score - a.score);
        const items = scored.map((s) => s.item);
        return new vscode.CompletionList(items, true);
      },
    },
    '"',
  );
}
