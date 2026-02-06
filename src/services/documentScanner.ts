import * as vscode from "vscode";
import * as path from "path";
import { collectConfigObjectsForDocument } from "../config";
import { findAllLocalizationCalls } from "../utils";
import { POManager } from "./poManager";

export interface ScanHelpers {
  poManager: POManager;
  diagnostics: vscode.DiagnosticCollection;
  getReferences: (msgid: string, allowedSourceDirs?: string[]) => Array<{ uri: vscode.Uri; range: vscode.Range }>;
  scanDirs: (dirs: string[], cfgs?: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[]) => Promise<void>;
  docMsgids: Map<string, Array<{ range: vscode.Range; msgid: string }>>;
  scannedDocs: Set<string>;
  scanningDocs: Set<string>;
  scheduleComputeUnusedForWorkspace: (key: string, cfgs: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]) => void;
}

export async function scanDocument(
  document: vscode.TextDocument,
  callerCfgs: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[] | undefined,
  helpers: ScanHelpers,
) {
  if (document.languageId !== "csharp") {
    return;
  }
  const uriStr = document.uri.toString();
  helpers.scanningDocs.add(uriStr);
  const text = document.getText();
  const ws = (vscode.workspace && typeof (vscode.workspace as any).getWorkspaceFolder === 'function') ? vscode.workspace.getWorkspaceFolder(document.uri) : undefined;

  // Determine matching configs for this document so we can use only their poDirs and funcs
  let cfgObjs = await collectConfigObjectsForDocument(document.uri);
  const docPath = document.uri.fsPath;
  let matchedCfgs = cfgObjs.filter((c) =>
    c.sourceDirs.some((sd) => docPath === sd || docPath.startsWith(sd + path.sep)),
  );

  // If no config matches this document from its own config lookup, try caller-provided configs (targeted scan)
  if (matchedCfgs.length === 0 && callerCfgs && callerCfgs.length > 0) {
    matchedCfgs = callerCfgs.filter((c) =>
      c.sourceDirs.some((sd) => docPath === sd || docPath.startsWith(sd + path.sep)),
    );
  }

  // If no config matches this document from its own config lookup, log and try caller-provided configs already handled above.
  if (matchedCfgs.length === 0) {
    helpers.scanningDocs.delete(uriStr);
    return;
  }

  let funcs: string[] = [];
  {
    const set = new Set<string>();
    for (const c of matchedCfgs) {
      for (const f of c.localizeFuncs || []) {
        set.add(f);
      }
    }
    funcs = Array.from(set);
    if (!funcs || funcs.length === 0) {
      funcs = ["G"];
    }
  }

  // Use shared utility to find localization calls
  const calls = findAllLocalizationCalls(text, funcs);
  const diags: vscode.Diagnostic[] = [];
  const entries: Array<{ range: any; msgid: string }> = [];
  for (const call of calls) {
    // Create a range-like object that works even if vscode.Range isn't available in this runtime
    let entryRange: any;
    try {
      if (vscode && typeof (vscode as any).Range === 'function') {
        entryRange = new (vscode as any).Range(document.positionAt(call.start), document.positionAt(call.end));
      } else {
        const s = document.positionAt(call.start);
        const e = document.positionAt(call.end);
        entryRange = { start: { line: s.line, character: s.character }, end: { line: e.line, character: e.character } };
      }
    } catch (_) {
      const s = document.positionAt(call.start);
      const e = document.positionAt(call.end);
      entryRange = { start: { line: s.line, character: s.character }, end: { line: e.line, character: e.character } };
    }
    entries.push({ range: entryRange, msgid: call.msgid });

    // restrict search to poDirs corresponding to this document; if none, skip (no fallback)
    const allowedPoDirs: string[] = [];
    for (const c of matchedCfgs) {
      for (const d of c.poDirs || []) {
        if (!allowedPoDirs.includes(d)) {
          allowedPoDirs.push(d);
        }
      }
    }
    if (allowedPoDirs.length === 0) {
      // no PO dirs associated with matched config — do not fallback to global search
      continue;
    }

    const statuses = helpers.poManager.getEntryStatus(call.msgid, allowedPoDirs);
    if (statuses.length === 0) {
      continue;
    }
    const missingList = statuses
      .filter((s) => !s.hasEntry || (s.translation !== undefined && s.translation === ""))
      .map((s) => s.relativePath);
    if (missingList.length > 0) {
      const startPos = document.positionAt(call.callStart);
      const endPos = document.positionAt(call.callEnd);
      const displayKey = call.msgid.replace(/\s+/g, " ");
      const truncatedKey = displayKey.length > 16 ? displayKey.slice(0, 16) + "…" : displayKey;
      const message = `Missing PO entries for '${truncatedKey}': ${missingList.join(", ")}`;

      // Safely create diagnostics: if vscode.Diagnostic/Range constructors are unavailable, skip diagnostic creation but continue scanning
      try {
        if (vscode && typeof (vscode as any).Diagnostic === 'function' && typeof (vscode as any).Range === 'function') {
          const diagRange = new (vscode as any).Range(startPos, endPos);
          const diag = new (vscode as any).Diagnostic(diagRange, message, (vscode as any).DiagnosticSeverity.Warning);
          diag.source = "po-dotnet";
          diags.push(diag);
        }
      } catch (_) {
        // ignore diagnostic creation errors to avoid aborting scanning in test/runtime environments
      }
    }
  }
  if (diags.length > 0) {
    helpers.diagnostics.set(document.uri, diags);
  } else {
    helpers.diagnostics.delete(document.uri);
  }

  // store found msgids for this document so references can be resolved
  if (entries.length > 0) {
    helpers.docMsgids.set(uriStr, entries);
  } else {
    helpers.docMsgids.delete(uriStr);
  }

  // mark as scanned and clear scanning mark
  helpers.scannedDocs.add(uriStr);
  helpers.scanningDocs.delete(uriStr);

  // schedule unused PO diagnostics recomputation for the workspace(s) that matched this doc
  if (matchedCfgs.length > 0) {
    const key = ws && ws.uri ? ws.uri.toString() : "";
    // ensure workspaceFolder is non-null for the scheduled computation
    const safeCfgs = matchedCfgs
      .filter((c) => !!c.workspaceFolder)
      .map((c) => ({
        sourceDirs: c.sourceDirs,
        poDirs: c.poDirs,
        localizeFuncs: c.localizeFuncs,
        workspaceFolder: c.workspaceFolder as vscode.WorkspaceFolder,
      }));
    if (safeCfgs.length > 0) {
      helpers.scheduleComputeUnusedForWorkspace(key, safeCfgs);
    }
  }
}
