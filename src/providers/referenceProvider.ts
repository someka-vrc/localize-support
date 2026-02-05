import * as vscode from "vscode";
import * as path from "path";
import { LocalizationService } from "../services/localizationService";
import { POService } from "../services/poService";
import { parsePo } from "../utils";
import { collectConfigObjectsForDocument } from "../config";

export function registerReferenceProvider(
  context: vscode.ExtensionContext,
  localizationService: LocalizationService,
  poService: POService,
) {
  return vscode.languages.registerReferenceProvider({ pattern: "**/*.po" }, {
    async provideReferences(document, position, contextRef, token) {
      const text = document.getText();
      const map = parsePo(text);
      const entries: Array<{ msgid: string; line: number }> = [];
      for (const [k, v] of map.entries()) {
        entries.push({ msgid: k, line: v.line });
      }
      if (entries.length === 0) {
        vscode.window.showInformationMessage("No msgid found at current position in PO file.");
        return [] as vscode.Location[];
      }
      entries.sort((a, b) => a.line - b.line);
      let found: string | null = null;
      for (let i = 0; i < entries.length; i++) {
        const start = entries[i].line;
        const end = i + 1 < entries.length ? entries[i + 1].line - 1 : Number.MAX_SAFE_INTEGER;
        if (position.line >= start && position.line <= end) {
          found = entries[i].msgid;
          break;
        }
      }
      if (!found || found.trim() === "") {
        vscode.window.showInformationMessage("No msgid found at current position in PO file.");
        return [] as vscode.Location[];
      }

      // determine allowed source dirs by matching configs that include this PO file in their poDirs
      const cfgObjs = await collectConfigObjectsForDocument(document.uri);
      const poPath = document.uri.fsPath;
      const allowedSourceDirs: string[] = [];
      for (const c of cfgObjs) {
        for (const pd of c.poDirs || []) {
          if (poPath === pd || poPath.startsWith(pd + path.sep)) {
            for (const sd of c.sourceDirs || []) {
              if (!allowedSourceDirs.includes(sd)) {
                allowedSourceDirs.push(sd);
              }
            }
          }
        }
      }

      if (allowedSourceDirs.length === 0) {
        vscode.window.showInformationMessage("No configuration found linking this PO file to source directories.");
        return [] as vscode.Location[];
      }

      let refs = localizationService.getReferences(found, allowedSourceDirs);

      // If no refs found immediately, attempt targeted scan of allowed source dirs (handles dirs outside workspace)
      if (!refs || refs.length === 0) {
        if (allowedSourceDirs && allowedSourceDirs.length > 0) {
          try {
            await localizationService.scanDirs(allowedSourceDirs);
          } catch (e) {
            // ignore
          }
        }
        try {
          await localizationService.triggerScan();
        } catch (e) {
          // ignore
        }
        // poll for up to ~2s (200ms * 10 attempts)
        const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
        for (let i = 0; i < 10; i++) {
          refs = localizationService.getReferences(found, allowedSourceDirs);
          if (refs && refs.length > 0) {
            break;
          }
          await sleep(200);
        }
      }

      if (!refs || refs.length === 0) {
        console.log(`po-dotnet: No references found for '${found}'. Allowed source dirs:`, allowedSourceDirs);
        vscode.window.showInformationMessage(`No references found for '${found}'.`);
        return [] as vscode.Location[];
      }

      return refs.map((r) => new vscode.Location(r.uri, r.range));
    },
  });
}
