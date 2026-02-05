import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { parsePoEntries } from "../utils";

export async function computeUnusedPoDiagnostics(
  poManager: POManager,
  diagnostics: vscode.DiagnosticCollection,
  cfgsByWorkspace: Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>,
  refResolver?: (msgid: string, allowedSourceDirs?: string[]) => Array<{ uri: vscode.Uri; range: vscode.Range }>,
  scanFn?: (allowedSourceDirs: string[], cfgList: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[], allowedPoDirs: string[], workspaceFolder: vscode.WorkspaceFolder) => Promise<void>,
) {
  try {
    // Collect diagnostics per PO file URI
    const poDiags = new Map<string, vscode.Diagnostic[]>();
    // Track which PO file URIs belong to the configs being processed to avoid touching unrelated files
    const relevantPoUris = new Set<string>();

    for (const [wsKey, cfgList] of cfgsByWorkspace) {
      for (const cfg of cfgList) {
        const allowedPoDirs = cfg.poDirs || [];
        const allowedSourceDirs = cfg.sourceDirs || [];
        try {
          const msgids = poManager.getAllMsgids(allowedPoDirs);
          for (const msgid of msgids) {
            // Skip header-like entries with empty msgid — they represent file metadata and should not be diagnosed as unused
            if (msgid.trim() === "") {
              continue;
            }

            // Use provided refResolver (if any) to detect usage.
            let refs = refResolver ? refResolver(msgid, allowedSourceDirs) : [];
            if (refs && refs.length > 0) {
              continue;
            }

            // If no refs found, attempt a targeted scan of allowed source dirs and re-check (handled by caller via scanFn)
            if (allowedSourceDirs && allowedSourceDirs.length > 0) {
              try {
                if (scanFn) {
                  try {
                    await scanFn(allowedSourceDirs, cfgList, allowedPoDirs, cfg.workspaceFolder as vscode.WorkspaceFolder);
                  } catch (_) {
                    // ignore per-scan errors
                  }
                }
              } catch (e) {
                // ignore scanning errors
              }

              // Re-check references after scanning
              refs = refResolver ? refResolver(msgid, allowedSourceDirs) : [];
              if (refs && refs.length > 0) {
                continue;
              }
            }

            // No references found -> mark each PO entry for this msgid as unused (if it has translation)
            const statuses = poManager.getEntryStatus(msgid, allowedPoDirs);
            for (const s of statuses) {
              if (!s.hasEntry) {
                continue;
              }
              if (!s.translation || s.translation.trim() === "") {
                // skip untranslated entries
                continue;
              }
              const uriStr = s.uri.toString();
              relevantPoUris.add(uriStr);
              try {
                const doc = await vscode.workspace.openTextDocument(s.uri);
                const lineNum = s.line || 0;
                let range: vscode.Range;
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
                  range = new vscode.Range(new vscode.Position(lineNum, startCol), new vscode.Position(lineNum, endCol));
                } catch (err) {
                  range = new vscode.Range(new vscode.Position(lineNum, 0), new vscode.Position(lineNum, 0));
                }

                const displayKey = msgid.replace(/\s+/g, " ").trim();
                const truncated = displayKey.length > 40 ? displayKey.slice(0, 40) + "…" : displayKey;
                const message = `Unused PO entry '${truncated}'`;
                const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
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

        // Detect duplicate msgid definitions within individual PO files and emit warnings
        try {
          const poUris = poManager.getPOFileUris(allowedPoDirs);
          for (const uri of poUris) {
            relevantPoUris.add(uri.toString());
            try {
              const doc = await vscode.workspace.openTextDocument(uri);
              const entries = parsePoEntries(doc.getText());
              const dupMap = new Map<string, number[]>();
              for (const e of entries) {
                // ignore header / metadata entry with empty id
                if (e.id === "") {
                  continue;
                }
                const arr = dupMap.get(e.id) || [];
                arr.push(e.line);
                dupMap.set(e.id, arr);
              }
              for (const [id, lines] of dupMap) {
                if (lines.length > 1) {
                  const displayKey = id.replace(/\s+/g, " ").trim();
                  const truncated = displayKey.length > 40 ? displayKey.slice(0, 40) + "…" : displayKey;
                  for (let idx = 1; idx < lines.length; idx++) {
                    const lineNum = lines[idx];
                    let range: vscode.Range;
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
                      range = new vscode.Range(new vscode.Position(lineNum, startCol), new vscode.Position(lineNum, endCol));
                    } catch (err) {
                      range = new vscode.Range(new vscode.Position(lineNum, 0), new vscode.Position(lineNum, 0));
                    }
                    const firstLine = lines[0] + 1;
                    const message = `Duplicate PO entry '${truncated}' (also at line ${firstLine})`;
                    const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
                    diag.source = "po-dotnet";

                    if (!poDiags.has(uri.toString())) {
                      poDiags.set(uri.toString(), []);
                    }
                    poDiags.get(uri.toString())!.push(diag);
                  }
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
          const uri = vscode.Uri.parse(uriStr);
          const diags = poDiags.get(uriStr) || [];
          if (diags.length > 0) {
            diagnostics.set(uri, diags);
          } else {
            diagnostics.delete(uri);
          }
        } catch (err) {
          // ignore
        }
      }
    } catch (err) {
      console.error("po-dotnet: failed to apply PO diagnostics", err);
    }
  } catch (err) {
    console.error("po-dotnet: failed to compute PO diagnostics", err);
  }
}
