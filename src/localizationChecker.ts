import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { extractFirstStringArgument } from "./utils";
import { collectConfigObjectsForDocument } from "./config";

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
        this.poManager.onDidChange(() => this.triggerScan()),
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

  public async scanDirs(dirs: string[]) {
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
                await this.scanDocument(doc);
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
  }

  private async scanDocument(document: vscode.TextDocument) {
    if (document.languageId !== "csharp") {
      return;
    }
    const uriStr = document.uri.toString();
    this.scanningDocs.add(uriStr);
    const text = document.getText();
    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
    // Determine matching configs for this document so we can use only their poDirs and funcs
    const cfgObjs = await collectConfigObjectsForDocument(document.uri);
    const docPath = document.uri.fsPath;
    const matchedCfgs = cfgObjs.filter((c) =>
      c.sourceDirs.some((sd) => docPath === sd || docPath.startsWith(sd + path.sep)),
    );

    // If no config matches this document, do not scan — avoid cross-project fallbacks
    if (matchedCfgs.length === 0) {
      this.scanningDocs.delete(uriStr);
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
    this.docMsgids.set(uriStr, entries);
    console.log(`po-dotnet: scanned ${document.uri.fsPath}, found ${entries.length} msgid entries:`, entries.map((e) => e.msgid));
    this.scanningDocs.delete(uriStr);
    this.scannedDocs.add(uriStr);
  }
}
