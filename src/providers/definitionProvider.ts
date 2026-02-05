import * as vscode from "vscode";
import { LocalizationService } from "../services/localizationService";
import { POService } from "../services/poService";
import { extractFirstStringArgument } from "../utils";

export function registerDefinitionProvider(
  context: vscode.ExtensionContext,
  localizationService: LocalizationService,
  poService: POService,
) {
  return vscode.languages.registerDefinitionProvider("csharp", {
    async provideDefinition(document, position, token) {
      // Try to get msgid from scanned cache
      const cached = localizationService.getMsgidAtPosition(document, position);
      if (cached === "scanning") {
        return undefined;
      }

      let msgid: string | null = null;
      let originRange: vscode.Range | undefined;

      if (cached) {
        msgid = cached.msgid;
        originRange = cached.range;
      } else {
        // fallback: parse function call around position to extract first string argument
        const text = document.getText();
        const offset = document.offsetAt(position);
        // find nearest function call by scanning backwards for a function name and opening paren
        // Simple heuristic similar to hover provider: search for '(' before offset
        let parenIndex = -1;
        for (let i = offset - 1; i >= 0; i--) {
          const ch = text[i];
          if (ch === '(') {
            parenIndex = i;
            break;
          }
          if (ch === '\n') {
            break; // too far
          }
        }
        if (parenIndex === -1) {
          return undefined;
        }
        // find matching closing paren after parenIndex
        let depth = 0;
        let j = parenIndex;
        for (; j < text.length; j++) {
          const ch = text[j];
          if (ch === '(') {
            depth++;
          } else if (ch === ')') {
            depth--;
            if (depth === 0) {
              break;
            }
          }
        }
        if (j >= text.length) {
          return undefined;
        }
        const inside = text.substring(parenIndex + 1, j);
        const extracted = extractFirstStringArgument(inside);
        if (!extracted) {
          return undefined;
        }
        msgid = extracted;
        originRange = new vscode.Range(document.positionAt(parenIndex), document.positionAt(j + 1));
      }

      if (!msgid) {
        return undefined;
      }

      const matched = await localizationService.getAllowedPoDirsForDocument(document);
      if (matched.length === 0) {
        return undefined;
      }

      for (const c of matched) {
        await poService.ensureDirs(c.poDirs, c.workspaceFolder);
      }
      const allowedPoDirs = Array.from(new Set(matched.flatMap((c) => c.poDirs)));

      const locations = poService.getDefinitionLocations(msgid, allowedPoDirs);
      if (!locations || locations.length === 0) {
        return undefined;
      }

      // convert to LocationLinks to include origin range
      const links: vscode.LocationLink[] = locations.map((loc) => ({
        targetUri: loc.uri,
        targetRange: new vscode.Range(loc.range.start, loc.range.end),
        targetSelectionRange: new vscode.Range(loc.range.start, loc.range.start),
        originSelectionRange: originRange,
      }));

      return links;
    },
  });
}
