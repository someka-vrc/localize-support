import type * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { parsePoEntries } from "../utils";

function getVscode() {
  // lazy require to avoid loading 'vscode' in plain node test runs
  return require('vscode') as typeof import('vscode');
}

// Pure helpers (easy to unit test)
export function determineUnusedStatuses(
  msgid: string,
  statuses: Array<{ uri: vscode.Uri; relativePath: string; hasEntry: boolean; translation: string | undefined; line?: number }>,
  refResolver?: (msgid: string, allowedSourceDirs?: string[]) => Array<{ uri: vscode.Uri; range: vscode.Range }>,
  allowedSourceDirs?: string[],
) {
  const refs = refResolver ? refResolver(msgid, allowedSourceDirs) : [];
  if (refs && refs.length > 0) {
    return [] as typeof statuses;
  }
  return statuses.filter((s) => s.hasEntry && s.translation !== undefined && s.translation !== "");
}

export function detectDuplicateMap(entries: Array<{ id: string; translation: string; line: number }>) {
  const dup = new Map<string, number[]>();
  for (const e of entries) {
    if (e.id === "") {continue;} // skip header
    const arr = dup.get(e.id) || [];
    arr.push(e.line);
    dup.set(e.id, arr);
  }
  const res = new Map<string, number[]>();
  for (const [k, v] of dup) {
    if (v.length > 1) {
      res.set(k, v);
    }
  }
  return res;
}

export function computeQuoteRangeFromDocLine(doc: { lineAt(n:number): { text: string } }, lineNum: number) {
  try {
    const lineText = doc.lineAt(lineNum).text;
    const firstQuote = lineText.indexOf('"');
    let startCol = 0;
    let endCol = lineText.length;
    if (firstQuote >= 0) {
      const secondQuote = lineText.indexOf('"', firstQuote + 1);
      if (secondQuote > firstQuote) {
        startCol = firstQuote + 1;
        endCol = secondQuote;
      } else {
        startCol = firstQuote;
        endCol = firstQuote + 1;
      }
    }
    // Return a plain object with shape similar to vscode.Range so unit tests don't need 'vscode' at runtime
    return { start: { line: lineNum, character: startCol }, end: { line: lineNum, character: endCol } };
  } catch (err) {
    return { start: { line: lineNum, character: 0 }, end: { line: lineNum, character: 0 } };
  }
}

export class PODiagnostics {
  constructor(private poManager: POManager, private diagnostics: vscode.DiagnosticCollection) {}

  public async compute(
    cfgsByWorkspace: Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>,
    refResolver?: (msgid: string, allowedSourceDirs?: string[]) => Array<{ uri: vscode.Uri; range: vscode.Range }>,
    scanFn?: (allowedSourceDirs: string[], cfgList: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[], allowedPoDirs: string[], workspaceFolder: vscode.WorkspaceFolder) => Promise<void>,
  ) {
    // Collect diagnostics per PO file URI
    const poDiags = new Map<string, vscode.Diagnostic[]>();
    // Track which PO file URIs belong to the configs being processed to avoid touching unrelated files
    const relevantPoUris = new Set<string>();

    for (const [wsKey, cfgList] of cfgsByWorkspace) {
      for (const cfg of cfgList) {
        const allowedPoDirs = cfg.poDirs || [];
        const allowedSourceDirs = cfg.sourceDirs || [];
        try {
          const msgids = this.poManager.getAllMsgids(allowedPoDirs);
          for (const msgid of msgids) {
            if (msgid === "") {continue;} // skip header

            // Use resolver first
            let refs = refResolver ? refResolver(msgid, allowedSourceDirs) : [];
            if (refs && refs.length > 0) {continue;}

            if (allowedSourceDirs && allowedSourceDirs.length > 0) {
              if (scanFn) {
                try {
                  await scanFn(allowedSourceDirs, cfgList, allowedPoDirs, cfg.workspaceFolder as vscode.WorkspaceFolder);
                } catch (_) {
                  // ignore per-scan errors
                }
              }
              refs = refResolver ? refResolver(msgid, allowedSourceDirs) : [];
              if (refs && refs.length > 0) {continue;}
            }

            const statuses = this.poManager.getEntryStatus(msgid, allowedPoDirs);
            const unusedStatuses = determineUnusedStatuses(msgid, statuses, refResolver, allowedSourceDirs);
            for (const s of unusedStatuses) {
              const uriStr = s.uri.toString();
              relevantPoUris.add(uriStr);
              try {
                const vscodeRt = getVscode();
                const doc = await vscodeRt.workspace.openTextDocument(s.uri);
                const lineNum = s.line || 0;
                const range = computeQuoteRangeFromDocLine(doc, lineNum);

                const displayKey = msgid.replace(/\s+/g, " ");
                const truncated = displayKey.length > 40 ? displayKey.slice(0, 40) + "…" : displayKey;
                const message = `Unused PO entry '${truncated}'`;
                // convert range-like object to real vscode.Range when running inside vscode
                const realRange = (range && (range.start && range.end && typeof range.start.character === 'number'))
                  ? new vscodeRt.Range(new vscodeRt.Position(range.start.line, range.start.character), new vscodeRt.Position(range.end.line, range.end.character))
                  : range as any;
                const diag = new vscodeRt.Diagnostic(realRange as any, message, vscodeRt.DiagnosticSeverity.Information);
                diag.source = "po-dotnet";

                if (!poDiags.has(uriStr)) {
                  poDiags.set(uriStr, []);
                }
                poDiags.get(uriStr)!.push(diag);
              } catch (err) {
                // ignore errors opening po doc
              }
            }
          }
        } catch (err) {
          console.error("po-dotnet: error while computing unused PO diagnostics", err);
        }

        // detect duplicates per file
        try {
          const poUris = this.poManager.getPOFileUris(allowedPoDirs);
          for (const uri of poUris) {
            relevantPoUris.add(uri.toString());
            try {
              const vscodeRt = getVscode();
              const doc = await vscodeRt.workspace.openTextDocument(uri);
              const entries = parsePoEntries(doc.getText());
              const dups = detectDuplicateMap(entries);
              for (const [id, lines] of dups) {
                const displayKey = id.replace(/\s+/g, " ");
                const truncated = displayKey.length > 40 ? displayKey.slice(0, 40) + "…" : displayKey;
                for (let idx = 1; idx < lines.length; idx++) {
                  const lineNum = lines[idx];
                  const range = computeQuoteRangeFromDocLine(doc, lineNum);
                  const firstLine = lines[0] + 1;
                  const message = `Duplicate PO entry '${truncated}' (also at line ${firstLine})`;
                  const vscodeRt = getVscode();
                  const realRange = (range && (range.start && range.end && typeof range.start.character === 'number'))
                    ? new vscodeRt.Range(new vscodeRt.Position(range.start.line, range.start.character), new vscodeRt.Position(range.end.line, range.end.character))
                    : range as any;
                  const diag = new vscodeRt.Diagnostic(realRange as any, message, vscodeRt.DiagnosticSeverity.Warning);
                  diag.source = "po-dotnet";

                  if (!poDiags.has(uri.toString())) {
                    poDiags.set(uri.toString(), []);
                  }
                  poDiags.get(uri.toString())!.push(diag);
                }
              }
            } catch (err) {
              // ignore
            }
          }
        } catch (err) {
          // ignore
        }
      }
    }

    // Apply diagnostics to PO files — only touch PO files that are relevant for the processed configs
    try {
      for (const uriStr of relevantPoUris) {
        try {
          const vscodeRt = getVscode();
          const uri = vscodeRt.Uri.parse(uriStr);
          const diags = poDiags.get(uriStr) || [];
          if (diags.length > 0) {
            this.diagnostics.set(uri, diags);
          } else {
            this.diagnostics.delete(uri);
          }
        } catch (err) {
          // ignore
        }
      }
    } catch (err) {
      console.error("po-dotnet: failed to apply PO diagnostics", err);
    }
  }
}


export async function computeUnusedPoDiagnostics(
  poManager: POManager,
  diagnostics: vscode.DiagnosticCollection,
  cfgsByWorkspace: Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>,
  refResolver?: (msgid: string, allowedSourceDirs?: string[]) => Array<{ uri: vscode.Uri; range: vscode.Range }>,
  scanFn?: (allowedSourceDirs: string[], cfgList: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[], allowedPoDirs: string[], workspaceFolder: vscode.WorkspaceFolder) => Promise<void>,
) {
  const impl = new PODiagnostics(poManager, diagnostics);
  return impl.compute(cfgsByWorkspace, refResolver, scanFn);
}
