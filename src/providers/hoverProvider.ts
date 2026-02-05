import * as vscode from "vscode";
import * as path from "path";
import { LocalizationService } from "../services/localizationService";
import { POService } from "../services/poService";
import { isInComment, extractFirstStringArgumentRange } from "../utils";

export function registerHoverProvider(
  context: vscode.ExtensionContext,
  localizationService: LocalizationService,
  poService: POService,
) {
  return vscode.languages.registerHoverProvider("csharp", {
    async provideHover(document, position, token) {
      const text = document.getText();
      const offset = document.offsetAt(position);

      if (isInComment(text, offset)) {
        return undefined;
      }

      const cached = localizationService.getMsgidAtPosition(document, position);
      if (cached === "scanning") {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown("po-dotnet\n\nScanning...");
        return new vscode.Hover(md);
      } else if (cached) {
        const msgid = cached.msgid;
        const startPos = cached.range.start;
        const endPos = cached.range.end;
        const matched = await localizationService.getAllowedPoDirsForDocument(document);
        if (matched.length === 0) {
          return undefined;
        }
        // ensure PO dirs watched
        for (const c of matched) {
          await poService.ensureDirs(c.poDirs, c.workspaceFolder);
        }
        const allowedPoDirs = Array.from(new Set(matched.flatMap((c) => c.poDirs)));
        const entries = poService.getTranslations(msgid, allowedPoDirs);
        const hoverLines: string[] = [];
        hoverLines.push("po-dotnet");
        if (entries.length === 0) {
          hoverLines.push("- No entry");
        } else {
          hoverLines.push("");
          for (const e of entries) {
            const fileName = path.basename(e.relativePath);
            const message = e.translation.replace(/`/g, "'");
            const folderPath = path.dirname(e.relativePath) || ".";
            const fileLink = `[${fileName}](command:po-dotnet.openPoEntry?${encodeURIComponent(JSON.stringify([e.uri.toString(), e.line]))})`;
            hoverLines.push(`- ${fileLink}: \`${message}\` (${folderPath})`);
          }
        }
        const md = new vscode.MarkdownString("", true);
        md.isTrusted = true;
        md.appendMarkdown(hoverLines.join("\n\n"));
        return new vscode.Hover(md, new vscode.Range(startPos, endPos));
      }

      // fallback: find function and string literal manually
      const cfgForFuncs = await (async () => {
        // reuse localizationService to get funcs via collectConfigsForDocument
        const infos = await localizationService.getAllowedPoDirsForDocument(document);
        // return funcs not available here; use default 'G' fallback
        return { localizeFuncs: ["G"] };
      })();
      const funcs = cfgForFuncs.localizeFuncs && cfgForFuncs.localizeFuncs.length > 0
        ? cfgForFuncs.localizeFuncs
        : ["G"];
      const escapeRegExp = (s: string) =>
        s.replace(/[.*+?^${}()|[\\\\]\\]/g, "\\$&");
      const re = new RegExp(
        `\\b(?:${funcs.map(escapeRegExp).join("|")})\\b`,
        "g",
      );
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const matchIndex = match.index;
        let i = matchIndex + match[0].length;
        while (i < text.length && /\s/.test(text[i])) {
          i++;
        }
        if (i >= text.length || text[i] !== "(") {
          continue;
        }
        let depth = 0;
        let j = i;
        for (; j < text.length; j++) {
          const ch = text[j];
          if (ch === "(") {
            depth++;
          } else if (ch === ")") {
            depth--;
            if (depth === 0) {
              const inside = text.substring(i + 1, j);
              const arg = extractFirstStringArgumentRange(inside, i + 1);
              if (!arg) {
                break;
              }
              const startOffset = arg.start;
              const endOffset = arg.end;
              if (offset >= startOffset && offset <= endOffset) {
                const msgid = arg.msgid;
                const matched = await localizationService.getAllowedPoDirsForDocument(document);
                if (matched.length === 0) {
                  return undefined;
                }
                for (const c of matched) {
                  await poService.ensureDirs(c.poDirs, c.workspaceFolder);
                }
                const allowedPoDirs = Array.from(new Set(matched.flatMap((c) => c.poDirs)));
                const entries = poService.getTranslations(msgid, allowedPoDirs);
                const hoverLines: string[] = [];
                hoverLines.push("po-dotnet");
                if (entries.length === 0) {
                  hoverLines.push("- No entry");
                } else {
                  hoverLines.push("");
                  for (const e of entries) {
                    const fileName = path.basename(e.relativePath);
                    const message = e.translation.replace(/`/g, "'");
                    const folderPath = path.dirname(e.relativePath) || ".";
                    const fileLink = `[${fileName}](command:po-dotnet.openPoEntry?${encodeURIComponent(JSON.stringify([e.uri.toString(), e.line]))})`;
                    hoverLines.push(
                      `- ${fileLink}: \`${message}\` (${folderPath})`,
                    );
                  }
                }
                const md = new vscode.MarkdownString("", true);
                md.isTrusted = true;
                const startPos = document.positionAt(startOffset);
                const endPos = document.positionAt(endOffset);
                md.appendMarkdown(hoverLines.join("\n\n"));
                return new vscode.Hover(md, new vscode.Range(startPos, endPos));
              }
              break;
            }
          }
        }
      }

      return undefined;
    },
  });
}
