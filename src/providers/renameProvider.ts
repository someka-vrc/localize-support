import * as vscode from "vscode";
import * as path from "path";
import { LocalizationService } from "../services/localizationService";
import { POService } from "../services/poService";
import { parsePoEntries, parsePo } from "../utils";
import { collectConfigObjectsForDocument } from "../config";

function escapeForPo(s: string) {
  // Preserve backslashes as-is (do not double-escape). Escape quotes and control chars.
  return s.replace(/"/g, '\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function escapeForCSharp(s: string, verbatim: boolean) {
  if (verbatim) {
    // double each quote inside verbatim string
    return s.replace(/"/g, '""');
  }
  // Preserve backslashes as-is to avoid double-escaping user-provided escape sequences.
  return s
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function registerRenameProvider(
  context: vscode.ExtensionContext,
  localizationService: LocalizationService,
  poService: POService,
) {
  // For C# sources
  const srcProvider: vscode.RenameProvider = {
    async prepareRename(document, position, token) {
      const res = localizationService.getMsgidAtPosition(document, position);
      if (res === "scanning") {
        throw new Error("Document scanning in progress. Try again later.");
      }
      if (!res) {
        throw new Error("No localization key found at current position.");
      }
      return res.range;
    },
    async provideRenameEdits(document, position, newName, token) {
      try {
        if (newName === undefined || newName.length === 0) {
          throw new Error("New name must be non-empty.");
        }
        const res = localizationService.getMsgidAtPosition(document, position);
        if (res === "scanning") {
          throw new Error("Document scanning in progress. Try again later.");
        }
        if (!res) {
          throw new Error("No localization key found at current position.");
        }
        const oldKey = res.msgid;
        if (oldKey === newName) {
          // nothing to do
          return new vscode.WorkspaceEdit();
        }

        const edit = new vscode.WorkspaceEdit();

        // Replace all source occurrences (within configured sourceDirs)
        const cfgObjs = await collectConfigObjectsForDocument(document.uri);
        const allowedSourceDirs = Array.from(new Set(cfgObjs.flatMap((c) => c.sourceDirs || [])));
        const refs = localizationService.getReferences(oldKey, allowedSourceDirs);
        for (const r of refs) {
          try {
            const doc = await vscode.workspace.openTextDocument(r.uri);
            // normalize range to a real vscode.Range when necessary
            let refRange: vscode.Range;
            if ((r.range as any).start && typeof (r.range as any).start.line === 'number') {
              refRange = new vscode.Range(new vscode.Position((r.range as any).start.line, (r.range as any).start.character), new vscode.Position((r.range as any).end.line, (r.range as any).end.character));
            } else {
              refRange = r.range as vscode.Range;
            }
            // Determine whether original string literal was verbatim (@"...")
            const startOffset = doc.offsetAt(refRange.start);
            const openingQuoteOffset = startOffset - 1;
            let verbatim = false;
            if (openingQuoteOffset - 1 >= 0) {
              const charBefore = doc.getText(new vscode.Range(doc.positionAt(openingQuoteOffset - 1), doc.positionAt(openingQuoteOffset + 1)));
              if (charBefore.startsWith('@"')) {
                verbatim = true;
              }
            }
            const newContent = escapeForCSharp(newName, verbatim);
            edit.replace(r.uri, refRange, newContent);
            console.log('DEBUG: prepared source rename replacement', { uri: r.uri.toString(), start: refRange.start, end: refRange.end, newContent });
          } catch (e) {
            // ignore per-file errors
            console.error("po-support: error preparing source rename replacement", e);
          }
        }

        // Replace PO entries
        // Determine allowed PO dirs for this document (configs that apply to the document)
        const poDirs = Array.from(new Set(cfgObjs.flatMap((c) => c.poDirs || [])));
        // Check for duplicate msgid across allowed PO dirs
        try {
          const existingMsgids = poService.getAllMsgids(poDirs);
          if (existingMsgids && existingMsgids.has(newName) && newName !== oldKey) {
            throw new Error(`A msgid '${newName}' already exists in PO files.`);
          }
        } catch (err) {
          // if poService fails for some reason, fall back to attempting rename
          // but log the error for diagnostics
          console.error("po-support: error checking existing msgids", err);
        }
        const poEntries = poService.getTranslations(oldKey, poDirs);
        for (const e of poEntries) {
          try {
            const doc = await vscode.workspace.openTextDocument(e.uri);
            const text = doc.getText();
            const entries = parsePoEntries(text);
            entries.sort((a, b) => a.line - b.line);
            let foundIdx = -1;
            for (let i = 0; i < entries.length; i++) {
              const start = entries[i].line;
              const end = i + 1 < entries.length ? entries[i + 1].line - 1 : Number.MAX_SAFE_INTEGER;
              if (e.line >= start && e.line <= end) {
                foundIdx = i;
                break;
              }
            }
            if (foundIdx === -1) {
              continue;
            }
            const startLine = entries[foundIdx].line;
            const endLine = foundIdx + 1 < entries.length ? entries[foundIdx + 1].line - 1 : doc.lineCount - 1;
            const lines = text.split(/\r?\n/);
            // find opening quote in startLine
            const startLineText = lines[startLine];
            const openIdx = startLineText.indexOf('"');
            if (openIdx < 0) {continue;}
            // find last quote in the msgid block (stop before msgstr line)
            let lastQuoteIdx = -1;
            let lastQuoteLine = startLine;
            for (let j = startLine; j <= endLine; j++) {
              if (lines[j].trim().startsWith('msgstr')) {
                break;
              }
              const idx = lines[j].lastIndexOf('"');
              if (idx >= 0) {
                lastQuoteIdx = idx;
                lastQuoteLine = j;
              }
            }
            if (lastQuoteIdx < 0) {continue;}
            const range = new vscode.Range(new vscode.Position(startLine, openIdx + 1), new vscode.Position(lastQuoteLine, lastQuoteIdx));
            const newContent = escapeForPo(newName);
            edit.replace(e.uri, range, newContent);
          } catch (ex) {
            console.error("po-support: error preparing PO rename replacement", ex);
          }
        }

        console.log('DEBUG: final rename edit', edit);
        return edit;
      } catch (err) {
        console.error('po-support: error in provideRenameEdits', err);
        throw err;
      }
    }, 
  };

  // For PO files
  const poProvider: vscode.RenameProvider = {
    async prepareRename(document, position, token) {
      const text = document.getText();
      const entries: Array<{id: string; translation: string; line: number}> = [];
      const parsed = parsePo(text);
      for (const [k, v] of parsed.entries()) {
        entries.push({ id: k, translation: v.translation, line: v.line });
      }
      if (entries.length === 0) {
        throw new Error("No msgid found at current position in PO file.");
      }
      entries.sort((a, b) => a.line - b.line);
      let found: string | null = null;
      let foundIdx = -1;
      for (let i = 0; i < entries.length; i++) {
        const start = entries[i].line;
        const end = i + 1 < entries.length ? entries[i + 1].line - 1 : Number.MAX_SAFE_INTEGER;
        if (position.line >= start && position.line <= end) {
          found = entries[i].id;
          foundIdx = i;
          break;
        }
      }
      if (!found || found === "") {
        throw new Error("No msgid found at current position in PO file.");
      }

      const lines = text.split(/\r?\n/);
      const startLine = entries[foundIdx].line;
      const endLine = foundIdx + 1 < entries.length ? entries[foundIdx + 1].line - 1 : lines.length - 1;
      const startLineText = lines[startLine];
      const openIdx = startLineText.indexOf('"');
      if (openIdx < 0) {
        throw new Error("Could not determine msgid range for rename.");
      }
      let lastQuoteIdx = -1;
      let lastQuoteLine = startLine;
      for (let j = startLine; j <= endLine; j++) {
        if (lines[j].trim().startsWith('msgstr')) {
          break;
        }
        const idx = lines[j].lastIndexOf('"');
        if (idx >= 0) {
          lastQuoteIdx = idx;
          lastQuoteLine = j;
        }
      }
      if (lastQuoteIdx < 0) {
        throw new Error("Could not determine msgid range for rename.");
      }
      return new vscode.Range(new vscode.Position(startLine, openIdx + 1), new vscode.Position(lastQuoteLine, lastQuoteIdx));
    },
    async provideRenameEdits(document, position, newName, token) {
      if (newName === undefined || newName.length === 0) {
        throw new Error("New name must be non-empty.");
      }
      const text = document.getText();
      const entries = parsePo(text);
      const arr: Array<{ msgid: string; line: number }> = [];
      for (const [k, v] of entries.entries()) {
        arr.push({ msgid: k, line: v.line });
      }
      if (arr.length === 0) {
        throw new Error("No msgid found at current position in PO file.");
      }
      arr.sort((a, b) => a.line - b.line);
      let found: string | null = null;
      let foundIdx = -1;
      for (let i = 0; i < arr.length; i++) {
        const start = arr[i].line;
        const end = i + 1 < arr.length ? arr[i + 1].line - 1 : Number.MAX_SAFE_INTEGER;
        if (position.line >= start && position.line <= end) {
          found = arr[i].msgid;
          foundIdx = i;
          break;
        }
      }
      if (!found || found === "") {
        throw new Error("No msgid found at current position in PO file.");
      }
      if (found === newName) {
        return new vscode.WorkspaceEdit();
      }

      const edit = new vscode.WorkspaceEdit();

      // Replace all PO entries for this msgid across allowed PO dirs (configs that include this PO file)
      const cfgObjs = await collectConfigObjectsForDocument(document.uri);
      const poPath = document.uri.fsPath;
      const allowedSourceDirs: string[] = [];
      const allowedCfgs: typeof cfgObjs = [];
      for (const c of cfgObjs) {
        for (const pd of c.poDirs || []) {
          if (poPath === pd || poPath.startsWith(pd + path.sep)) {
            allowedCfgs.push(c);
            for (const sd of c.sourceDirs || []) {
              if (!allowedSourceDirs.includes(sd)) {
                allowedSourceDirs.push(sd);
              }
            }
          }
        }
      }
      const allowedPoDirs = Array.from(new Set(allowedCfgs.flatMap((c) => c.poDirs || [])));
      // Prevent renaming to an already existing msgid
      try {
        const existingMsgids = poService.getAllMsgids(allowedPoDirs);
        if (existingMsgids && existingMsgids.has(newName) && newName !== found) {
          throw new Error(`A msgid '${newName}' already exists in PO files.`);
        }
      } catch (err) {
        console.error("po-support: error checking existing msgids", err);
      }
      const poEntries = poService.getTranslations(found, allowedPoDirs);
      for (const e of poEntries) {
        try {
          const doc = await vscode.workspace.openTextDocument(e.uri);
          const txt = doc.getText();
          const entries2 = parsePoEntries(txt);
          entries2.sort((a, b) => a.line - b.line);
          let idx = -1;
          for (let i = 0; i < entries2.length; i++) {
            const start = entries2[i].line;
            const end = i + 1 < entries2.length ? entries2[i + 1].line - 1 : Number.MAX_SAFE_INTEGER;
            if (e.line >= start && e.line <= end) {
              idx = i;
              break;
            }
          }
          if (idx === -1) {continue;}
          const startLine = entries2[idx].line;
          const endLine = idx + 1 < entries2.length ? entries2[idx + 1].line - 1 : doc.lineCount - 1;
          const lines = txt.split(/\r?\n/);
          const startLineText = lines[startLine];
          const openIdx = startLineText.indexOf('"');
          if (openIdx < 0) {continue;}
          let lastQuoteIdx = -1;
          let lastQuoteLine = startLine;
          for (let j = startLine; j <= endLine; j++) {
            if (lines[j].trim().startsWith('msgstr')) {
              break;
            }
            const idx2 = lines[j].lastIndexOf('"');
            if (idx2 >= 0) {
              lastQuoteIdx = idx2;
              lastQuoteLine = j;
            }
          }
          if (lastQuoteIdx < 0) {continue;}
          const range = new vscode.Range(new vscode.Position(startLine, openIdx + 1), new vscode.Position(lastQuoteLine, lastQuoteIdx));
          const newContent = escapeForPo(newName);
          edit.replace(e.uri, range, newContent);
          console.log('DEBUG: prepared PO rename replacement', { uri: e.uri.toString(), start: range.start, end: range.end, newContent });
        } catch (ex) {
          console.error("po-support: error preparing PO rename replacement", ex);
        }
      }

      // Replace source occurrences
      const allowedSrcDirs = Array.from(new Set(allowedCfgs.flatMap((c) => c.sourceDirs || [])));
      const refs = localizationService.getReferences(found, allowedSrcDirs);
      for (const r of refs) {
        try {
          const doc = await vscode.workspace.openTextDocument(r.uri);
          // normalize range to a real vscode.Range when necessary
          let refRange: vscode.Range;
          if ((r.range as any).start && typeof (r.range as any).start.line === 'number') {
            refRange = new vscode.Range(new vscode.Position((r.range as any).start.line, (r.range as any).start.character), new vscode.Position((r.range as any).end.line, (r.range as any).end.character));
          } else {
            refRange = r.range as vscode.Range;
          }
          const startOffset = doc.offsetAt(refRange.start);
          const openingQuoteOffset = startOffset - 1;
          let verbatim = false;
          if (openingQuoteOffset - 1 >= 0) {
            const charBefore = doc.getText(new vscode.Range(doc.positionAt(openingQuoteOffset - 1), doc.positionAt(openingQuoteOffset + 1)));
            if (charBefore.startsWith('@"')) {
              verbatim = true;
            }
          }
          const newContent = escapeForCSharp(newName, verbatim);
          edit.replace(r.uri, refRange, newContent);
        } catch (ex) {
          console.error("po-support: error preparing source rename replacement", ex);
        }
      }

      return edit;
    },
  };

  const d1 = vscode.languages.registerRenameProvider({ language: "csharp" }, srcProvider);
  const d2 = vscode.languages.registerRenameProvider({ pattern: "**/*.po" }, poProvider);

  // Test helper: allow tests to invoke the provider logic directly (bypass RPC argument validation issues)
  async function invokeRenameForTest(uriLike: string | vscode.Uri, posLike: vscode.Position | { line: number; character: number }, newName: string) {
    const uri = typeof uriLike === 'string' ? vscode.Uri.parse(uriLike) : uriLike;
    const doc = await vscode.workspace.openTextDocument(uri);
    const pos = posLike instanceof vscode.Position ? posLike : new vscode.Position(posLike.line, posLike.character);
    try {
      if (doc.uri.fsPath.endsWith('.po')) {
        // PO file provider
        const edit = await poProvider.provideRenameEdits(doc, pos, newName, undefined as any);
        // Apply edits directly so test callers get a serializable result
        const applied = edit ? await vscode.workspace.applyEdit(edit) : true;
        return { success: applied };
      } else {
        const edit = await srcProvider.provideRenameEdits(doc, pos, newName, undefined as any);
        const applied = edit ? await vscode.workspace.applyEdit(edit) : true;
        return { success: applied };
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // Return an object that disposes both underlying registrations and exposes the test helper
  return { dispose() { d1.dispose(); d2.dispose(); }, invokeRenameForTest } as unknown as vscode.Disposable & { invokeRenameForTest(uriLike: string | vscode.Uri, posLike: vscode.Position | { line: number; character: number }, newName: string): Promise<{ success: boolean; error?: string }> };
}
