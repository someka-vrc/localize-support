import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { extractFirstStringArgument, extractFirstStringArgumentRange } from "../utils";
import { collectConfigObjectsForDocument, collectAllConfigsInWorkspace } from "../config";
import { computeUnusedPoDiagnostics as computeUnusedPoDiagnosticsImpl } from "./poDiagnostics"; 

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
    return results;
  }

  public async scanDirs(
    dirs: string[],
    cfgs?: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[],
  ) {
    const seen = new Set<string>();
    const walk = async (dir: string) => {
      try {
        const uri = vscode.Uri.file(dir);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
          const childPath = path.join(dir, name);
          if (type === vscode.FileType.Directory) {
            await walk(childPath);
          } else if (type === vscode.FileType.File && childPath.endsWith(".cs")) {
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
      // end is exclusive
      if (offset >= start && offset < end) {
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

  // Clear internal caches and trigger a full rescan of sources and PO files
  public async reload() {
    // Clear scanning/scan caches
    this.scannedDocs.clear();
    this.scanningDocs.clear();
    this.docMsgids.clear();
    this.workspaceLocalizeFuncs.clear();
    this.diagnostics.clear();
    // Clear PO cache and trigger change notification
    try {
      this.poManager.clearCache();
    } catch (_) {
      // ignore
    }
    // Trigger a full scan
    await this.triggerScan();
  }

  // Wait until no documents are being scanned and no pending compute timers remain
  public async waitUntilIdle(timeoutMs: number = 5000): Promise<void> {
    const start = Date.now();
    while (true) {
      const scanning = this.scanningDocs.size > 0;
      const hasTimers = this.computeTimers.size > 0;
      if (!scanning && !hasTimers) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('timeout waiting for idle');
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async scanAll() {
    const toScan: vscode.Uri[] = [];
    const cfgsByWorkspace = await collectAllConfigsInWorkspace();

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
    // Delegated to `poDiagnostics` module with reference resolver and scan function
    return await computeUnusedPoDiagnosticsImpl(
      this.poManager,
      this.diagnostics,
      cfgsByWorkspace,
      this.getReferences.bind(this),
      async (allowedSourceDirs, cfgList, allowedPoDirs, workspaceFolder) => {
        try {
          try {
            await this.poManager.ensureDirs(allowedPoDirs, workspaceFolder);
          } catch (_) {
            // ignore
          }
          await this.scanDirs(allowedSourceDirs, cfgList);
        } catch (e) {
          // ignore scanning errors
        }
      },
    );
  }

  private async scanDocument(
    document: vscode.TextDocument,
    callerCfgs?: { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[],
  ) {
    // Delegated to `documentScanner` to keep the scanning logic in a single file.
    const mod = (await import("./documentScanner.js" as any)) as any;
    await mod.scanDocument(document, callerCfgs, {
      poManager: this.poManager,
      diagnostics: this.diagnostics,
      getReferences: this.getReferences.bind(this),
      scanDirs: this.scanDirs.bind(this),
      docMsgids: this.docMsgids,
      scannedDocs: this.scannedDocs,
      scanningDocs: this.scanningDocs,
      scheduleComputeUnusedForWorkspace: this.scheduleComputeUnusedForWorkspace.bind(this),
    });
  }


}
