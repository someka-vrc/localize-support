import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { extractFirstStringArgument, parsePoEntries } from "../utils";
import { collectConfigObjectsForDocument } from "../config";

export class LocalizationChecker implements vscode.Disposable {
  private diagnostics =
    vscode.languages.createDiagnosticCollection("po-dotnet");
  private srcWatchers = new Map<string, vscode.FileSystemWatcher>();
  private disposables: vscode.Disposable[] = [];
  private scannedDocs = new Set<string>();
  private scanningDocs = new Set<string>();
  private docMsgids = new Map<
    string,
    Array<{ range: vscode.Range; msgid: string }>
  >();

    // workspace -> localize function names coming from podotnetconfig.json files
    private workspaceLocalizeFuncs = new Map<string, string[]>();

    // pending configs per workspace for deferred unused diagnostics computation
    private pendingCfgs = new Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>();
    private computeTimers = new Map<string, NodeJS.Timeout>();

    constructor(
      private context: vscode.ExtensionContext,
      private poManager: POManager,
    ) {
      this.context.subscriptions.push(this.diagnostics);
      const configWatcher = vscode.workspace.createFileSystemWatcher(
        "**/podotnetconfig.json",
      );
      this.context.subscriptions.push(configWatcher);
      configWatcher.onDidCreate(() => this.triggerScan());
      configWatcher.onDidChange(() => this.triggerScan());
      configWatcher.onDidDelete(() => this.triggerScan());
      this.disposables.push(
        this.poManager.onDidChange(async (e) => {
          try {
            if (e && e.uri) {
              const uri = vscode.Uri.parse(e.uri);
              const cfgs = await collectConfigObjectsForDocument(uri);
              if (cfgs && cfgs.length > 0) {
                // gather all sourceDirs from configs and de-duplicate
                const dirs = cfgs.reduce((acc: string[], c) => acc.concat(c.sourceDirs || []), [] as string[]);
                const allSourceDirs = Array.from(new Set(dirs));
                if (allSourceDirs.length > 0) {
                  console.log(`po-dotnet: PO changed ${uri.fsPath}, scanning ${allSourceDirs.length} source dirs`);
                  await this.scanDirs(allSourceDirs, cfgs);
                  // Build cfgsByWorkspace map for targeted diagnostics computation
                  const cfgsByWorkspace = new Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>();
                  for (const c of cfgs) {
                    const key = c.workspaceFolder && c.workspaceFolder.uri ? c.workspaceFolder.uri.toString() : "";
                    if (!cfgsByWorkspace.has(key)) {
                      cfgsByWorkspace.set(key, []);
                    }
                    cfgsByWorkspace.get(key)!.push(c as any);
                  }
                  // Schedule deferred computation per workspace (debounced)
                  for (const [key, list] of cfgsByWorkspace) {
                    this.scheduleComputeUnusedForWorkspace(key, list);
                  }
                  return;
                }
              }
            }
            // fallback to full scan
            await this.triggerScan();
          } catch (err) {
            console.error("po-dotnet: error handling PO change", err);
            await this.triggerScan();
          }
        }),
      );
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) =>
          this.onDocumentChanged(e.document),
        ),
      );
      this.triggerScan();
    }

  dispose() {
    this.diagnostics.dispose();
    for (const w of this.srcWatchers.values()) {
      w.dispose();
    }
    this.srcWatchers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    // clear any pending timers
    for (const t of this.computeTimers.values()) {
      clearTimeout(t as any);
    }
    this.computeTimers.clear();
    this.pendingCfgs.clear();
  }

  private onDocumentChanged(document: vscode.TextDocument) {
    if (document.languageId !== "csharp") {
      return;
    }
    this.scanDocument(document);
  }

  public isScanned(document: vscode.TextDocument): boolean {
    return this.scannedDocs.has(document.uri.toString());
  }

  public getReferences(msgid: string, allowedSourceDirs?: string[]) {
    const results: Array<{ uri: vscode.Uri; range: vscode.Range }> = [];
    for (const [uriStr, entries] of this.docMsgids) {
      const uri = vscode.Uri.parse(uriStr);
      const fsPath = uri.fsPath;
      if (allowedSourceDirs && allowedSourceDirs.length > 0) {
        let ok = false;
        for (const sd of allowedSourceDirs) {
          if (fsPath === sd || fsPath.startsWith(sd + path.sep)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          continue;
        }
      }
      for (const e of entries) {
        if (e.msgid === msgid) {
          results.push({ uri, range: e.range });
        }
      }
    }
    console.log(`po-dotnet: getReferences for '${msgid}' -> ${results.length} results`);
    return results;
  }

  public async scanDirs(
    dirs: string[],
    cfgs?: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[],
  ) {
    console.log(`po-dotnet: scanDirs start for ${dirs.length} dirs:`, dirs);
    const seen = new Set<string>();
    const walk = async (dir: string) => {
      try {
        console.log(`po-dotnet: walking directory: ${dir}`);
        const uri = vscode.Uri.file(dir);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
          const childPath = path.join(dir, name);
          if (type === vscode.FileType.Directory) {
            await walk(childPath);
          } else if (type === vscode.FileType.File && childPath.endsWith(".cs")) {
            console.log(`po-dotnet: found .cs file: ${childPath}`);
            const childUri = vscode.Uri.file(childPath);
            if (!seen.has(childUri.toString())) {
              seen.add(childUri.toString());
              try {
                const doc = await vscode.workspace.openTextDocument(childUri);
                await this.scanDocument(doc, cfgs);
              } catch (e) {
                console.error("po-dotnet: error scanning file", childPath, e);
              }
            }
          }
        }
      } catch (e) {
        console.error("po-dotnet: error reading directory", dir, e);
      }
    };
    for (const d of dirs) {
      await walk(d);
    }
    console.log(`po-dotnet: scanDirs completed for ${dirs.length} dirs`);
  }

  public getMsgidAt(
    document: vscode.TextDocument,
    offset: number,
  ): { msgid: string; range: vscode.Range } | "scanning" | null {
    const uriStr = document.uri.toString();
    if (this.scanningDocs.has(uriStr)) {
      return "scanning";
    }
    const entries = this.docMsgids.get(uriStr);
    if (!entries) {
      return null;
    }
    for (const e of entries) {
      const start = document.offsetAt(e.range.start);
      const end = document.offsetAt(e.range.end);
      if (offset >= start && offset <= end) {
        return { msgid: e.msgid, range: e.range };
      }
    }
    return null;
  }

  public async triggerScan() {
    try {
      await this.scanAll();
    } catch (e) {
      console.error("po-dotnet: error during scanAll", e);
    }
  }

  private async scanAll() {
    const cfgUris = await vscode.workspace.findFiles(
      "**/podotnetconfig.json",
    );
    const cfgUrisTilde = await vscode.workspace.findFiles(
      "**/podotnetconfig~.json",
    );
    const allCfgs = cfgUris.concat(cfgUrisTilde);
    const toScan: vscode.Uri[] = [];
    const cfgsByWorkspace = new Map<
      string,
      {
        sourceDirs: string[];
        poDirs: string[];
        localizeFuncs: string[];
        workspaceFolder: vscode.WorkspaceFolder;
      }[]
    >();
    for (const cfgUri of allCfgs) {
      const dir = path.dirname(cfgUri.fsPath);
      try {
        const bytes = await vscode.workspace.fs.readFile(cfgUri);
        const content = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(content);
        const sourceDirs: string[] = [];
        const poDirs: string[] = [];
        const localizeFuncs: string[] = [];
        const processCfg = (cfg: any) => {
          if (Array.isArray(cfg.sourceDirs)) {
            for (const s of cfg.sourceDirs) {
              sourceDirs.push(path.resolve(dir, s));
            }
          }
          if (Array.isArray(cfg.poDirs)) {
            for (const p of cfg.poDirs) {
              poDirs.push(path.resolve(dir, p));
            }
          }
          if (Array.isArray(cfg.localizeFuncs)) {
            for (const f of cfg.localizeFuncs) {
              if (typeof f === "string") {
                localizeFuncs.push(f);
              }
            }
          }
        };
        if (Array.isArray(parsed.config)) {
          for (const cfg of parsed.config) {
            processCfg(cfg);
          }
        } else {
          processCfg(parsed);
        }
        const ws = vscode.workspace.getWorkspaceFolder(cfgUri);
        if (!ws) {
          continue;
        }
        if (!cfgsByWorkspace.has(ws.uri.toString())) {
          cfgsByWorkspace.set(ws.uri.toString(), []);
        }
        cfgsByWorkspace
          .get(ws.uri.toString())!
          .push({ sourceDirs, poDirs, localizeFuncs, workspaceFolder: ws });
      } catch (e) {
        // ignore
      }
    }

    // collect localizeFuncs per workspace from config files
    for (const [wsKey, cfgList] of cfgsByWorkspace) {
      const set = new Set<string>();
      for (const cfg of cfgList) {
        for (const f of cfg.localizeFuncs || []) {
          set.add(f);
        }
      }
      if (set.size > 0) {
        this.workspaceLocalizeFuncs.set(wsKey, Array.from(set));
      } else {
        this.workspaceLocalizeFuncs.delete(wsKey);
      }
    }

    this.diagnostics.clear();

    for (const [wsKey, cfgList] of cfgsByWorkspace) {
      for (const cfg of cfgList) {
        await this.poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
        for (const sd of cfg.sourceDirs) {
          const rel = path
            .relative(cfg.workspaceFolder.uri.fsPath, sd)
            .replace(/\\/g, "/");
          const pattern = new vscode.RelativePattern(
            cfg.workspaceFolder,
            rel + "/**/*.cs",
          );
          const uris = await vscode.workspace.findFiles(pattern);
          for (const uri of uris) {
            toScan.push(uri);
            if (!this.srcWatchers.has(sd)) {
              const watcher =
                vscode.workspace.createFileSystemWatcher(pattern);
              this.context.subscriptions.push(watcher);
              watcher.onDidCreate((u) => this.triggerScan());
              watcher.onDidChange((u) => this.triggerScan());
              watcher.onDidDelete((u) => this.triggerScan());
              this.srcWatchers.set(sd, watcher);
            }
          }
        }
      }
    }

    console.log(`po-dotnet: scanAll will scan ${toScan.length} documents:`, toScan.map((u) => u.fsPath));
    for (const uri of toScan) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await this.scanDocument(doc);
      } catch (e) {
        console.error("po-dotnet: error scanning document", uri.toString(), e);
      }
    }

    // compute unused PO entry diagnostics (schedule per workspace so it's debounced)
    for (const [key, list] of cfgsByWorkspace) {
      this.scheduleComputeUnusedForWorkspace(key, list);
    }

  }

  private scheduleComputeUnusedForWorkspace(
    key: string,
    cfgs: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[],
  ) {
    // debounce to avoid frequent recomputation while typing
    this.pendingCfgs.set(key, cfgs);
    const existing = this.computeTimers.get(key);
    if (existing) {
      clearTimeout(existing as any);
    }
    const t = setTimeout(async () => {
      const cfgList = this.pendingCfgs.get(key) || [];
      const map = new Map<string, typeof cfgList>();
      map.set(key, cfgList);
      try {
        await this.computeUnusedPoDiagnostics(map);
      } catch (err) {
        console.error("po-dotnet: error computing deferred PO diagnostics", err);
      }
      this.pendingCfgs.delete(key);
      this.computeTimers.delete(key);
    }, 300);
    this.computeTimers.set(key, t);
  }

  private async computeUnusedPoDiagnostics(
    cfgsByWorkspace: Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>,
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
            const msgids = this.poManager.getAllMsgids(allowedPoDirs);
            for (const msgid of msgids) {
              // Skip header-like entries with empty msgid — they represent file metadata and should not be diagnosed as unused
              if (msgid.trim() === "") {
                continue;
              }

              // Use existing getReferences (which respects allowedSourceDirs) to detect usage.
              let refs = this.getReferences(msgid, allowedSourceDirs);
              if (refs && refs.length > 0) {
                continue;
              }

              // If no refs found, attempt a targeted scan of allowed source dirs and re-check (handles files outside workspace or not-yet-scanned files)
              if (allowedSourceDirs && allowedSourceDirs.length > 0) {
                try {
                  // Ensure PO dirs are read/watched so POManager has entries
                  try {
                    await this.poManager.ensureDirs(allowedPoDirs, cfg.workspaceFolder);
                  } catch (_) {
                    // ignore
                  }
                  await this.scanDirs(allowedSourceDirs, cfgList);
                } catch (e) {
                  // ignore scanning errors
                }

                // Re-check references after scanning
                refs = this.getReferences(msgid, allowedSourceDirs);
                if (refs && refs.length > 0) {
                  continue;
                }
              }

              // No references found -> mark each PO entry for this msgid as unused (if it has translation)
              const statuses = this.poManager.getEntryStatus(msgid, allowedPoDirs);
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
            const poUris = this.poManager.getPOFileUris(allowedPoDirs);
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
    } catch (err) {
      console.error("po-dotnet: failed to compute PO diagnostics", err);
    }
  }

  private async scanDocument(
    document: vscode.TextDocument,
    callerCfgs?: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[],
  ) {
    if (document.languageId !== "csharp") {
      return;
    }
    const uriStr = document.uri.toString();
    this.scanningDocs.add(uriStr);
    const text = document.getText();
    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
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
      console.log(`po-dotnet: scanDocument ${docPath} - no matching config found (callerCfgs present: ${!!callerCfgs && callerCfgs.length > 0})`);
      this.scanningDocs.delete(uriStr);
      return;
    }

    console.log(`po-dotnet: scanDocument ${docPath} matched ${matchedCfgs.length} config(s):`, matchedCfgs.map((c) => ({ sourceDirs: c.sourceDirs.length, poDirs: c.poDirs.length })));

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
    const escapeRegExp = (s: string) =>
      s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const re = new RegExp(`\\b(?:${funcs.map(escapeRegExp).join("|")})\\b`, "g");
    let match: RegExpExecArray | null;
    const diags: vscode.Diagnostic[] = [];
    const entries: Array<{ range: vscode.Range; msgid: string }> = [];
    while ((match = re.exec(text)) !== null) {
      const matchIndex = match.index;
      let i = matchIndex + match[0].length;
      while (i < text.length && /\\s/.test(text[i])) {
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
            const msgid = extractFirstStringArgument(inside);
            if (!msgid) {
              break;
            }
            entries.push({
              range: new vscode.Range(
                document.positionAt(matchIndex),
                document.positionAt(j + 1),
              ),
              msgid,
            });
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
              break;
            }
            const statuses = this.poManager.getEntryStatus(msgid, allowedPoDirs);
            if (statuses.length === 0) {
              break;
            }
            const missingList = statuses
              .filter(
                (s) =>
                  !s.hasEntry ||
                  (s.translation !== undefined &&
                    s.translation.trim() === ""),
              )
              .map((s) => s.relativePath);
            if (missingList.length > 0) {
              const startPos = document.positionAt(matchIndex);
              const endPos = document.positionAt(j + 1);
              const displayKey = msgid.replace(/\s+/g, " ").trim();
              const truncatedKey =
                displayKey.length > 16 ? displayKey.slice(0, 16) + "…" : displayKey;
              const message = `Missing PO entries for '${truncatedKey}': ${missingList.join(", ")}`;
              const diag = new vscode.Diagnostic(
                new vscode.Range(startPos, endPos),
                message,
                vscode.DiagnosticSeverity.Warning,
              );
              diag.source = "po-dotnet";
              diags.push(diag);
            }
            break;
          }
        }
      }
    }
    if (diags.length > 0) {
      this.diagnostics.set(document.uri, diags);
    } else {
      this.diagnostics.delete(document.uri);
    }

    // store found msgids for this document so references can be resolved
    if (entries.length > 0) {
      this.docMsgids.set(uriStr, entries);
    } else {
      this.docMsgids.delete(uriStr);
    }

    // mark as scanned and clear scanning mark
    this.scannedDocs.add(uriStr);
    this.scanningDocs.delete(uriStr);

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
        this.scheduleComputeUnusedForWorkspace(key, safeCfgs);
      }
    }
  }
}
