import * as vscode from "vscode";
import * as path from "path";
import { LocalizationChecker } from "./localizationChecker";
import { POManager } from "./poManager";
import { isInComment, extractFirstStringArgument } from "./utils";
import { collectConfigsForDocument } from "./config";

export function registerHoverProvider(
  context: vscode.ExtensionContext,
  localizationChecker: LocalizationChecker,
  poManager: POManager,
) {
  return vscode.languages.registerHoverProvider("csharp", {
    async provideHover(document, position, token) {

      const text = document.getText();
      const offset = document.offsetAt(position);

      if (isInComment(text, offset)) {
        return undefined;
      }

      const cached = localizationChecker.getMsgidAt(document, offset);
      if (cached === "scanning") {
        const md = new vscode.MarkdownString();
        md.appendMarkdown("po-dotnet\n\nScanning...");
        return new vscode.Hover(md);
      } else if (cached) {
        const msgid = cached.msgid;
        const startPos = cached.range.start;
        const endPos = cached.range.end;
        const cfg = await collectConfigsForDocument(document.uri);
        if (cfg.sourceDirs.length === 0) {
          return undefined;
        }
        const docPath = document.uri.fsPath;
        const included = cfg.sourceDirs.some(
          (sd) => docPath === sd || docPath.startsWith(sd + path.sep),
        );
        if (!included) {
          return undefined;
        }
        await poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
        const entries = poManager.getTranslations(msgid);
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
            hoverLines.push(`- ${fileName}: \`${message}\` (${folderPath})`);
          }
        }
        const md = new vscode.MarkdownString();
        md.appendMarkdown(hoverLines.join("\n\n"));
        return new vscode.Hover(md, new vscode.Range(startPos, endPos));
      }

      const cfgForFuncs = await collectConfigsForDocument(document.uri);
      const funcs = (cfgForFuncs.localizeFuncs && cfgForFuncs.localizeFuncs.length > 0)
        ? cfgForFuncs.localizeFuncs
        : [vscode.workspace.getConfiguration("poHover").get<string>("functionName", "G") || "G"];
      const escapeRegExp = (s: string) =>
        s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
      const re = new RegExp(`\\b(?:${funcs.map(escapeRegExp).join("|")})\\b`, "g");
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
              const startPos = document.positionAt(matchIndex);
              const endPos = document.positionAt(j + 1);
              const startOffset = matchIndex;
              const endOffset = j + 1;
              if (offset >= startOffset && offset <= endOffset) {
                const inside = text.substring(i + 1, j);
                const msgid = extractFirstStringArgument(inside);
                if (!msgid) {
                  return undefined;
                }
                const cfg = await collectConfigsForDocument(document.uri);
                if (cfg.sourceDirs.length === 0) {
                  return undefined;
                }
                const docPath = document.uri.fsPath;
                const included = cfg.sourceDirs.some(
                  (sd) => docPath === sd || docPath.startsWith(sd + path.sep),
                );
                if (!included) {
                  return undefined;
                }
                await poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
                const entries = poManager.getTranslations(msgid);
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
                    hoverLines.push(`- ${fileName}: \`${message}\` (${folderPath})`);
                  }
                }
                const md = new vscode.MarkdownString();
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
