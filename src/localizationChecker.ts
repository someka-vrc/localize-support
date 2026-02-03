import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./poManager";
import { extractFirstStringArgument } from "./utils";

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
        if (Array.isArray(parsed.sourceDirs)) {
          for (const s of parsed.sourceDirs) {
            sourceDirs.push(path.resolve(dir, s));
          }
        }
        if (Array.isArray(parsed.poDirs)) {
          for (const p of parsed.poDirs) {
            poDirs.push(path.resolve(dir, p));
          }
        }
        if (Array.isArray(parsed.localizeFuncs)) {
          for (const f of parsed.localizeFuncs) {
            if (typeof f === "string") {
              localizeFuncs.push(f);
            }
          }
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

    for (const uri of toScan) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await this.scanDocument(doc);
      } catch (e) {
        // ignore
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
    let funcs: string[] = [];
    if (ws) {
      funcs = this.workspaceLocalizeFuncs.get(ws.uri.toString()) || [];
    }
    if (!funcs || funcs.length === 0) {
      const cfgFunc =
        vscode.workspace
          .getConfiguration("poHover")
          .get<string>("functionName", "G") || "G";
      funcs = [cfgFunc];
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
            const statuses = this.poManager.getEntryStatus(msgid);
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
              const message = `po-dotnet: missing PO entries: ${missingList.join(", ")}`;
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
    this.scanningDocs.delete(uriStr);
    this.scannedDocs.add(uriStr);
  }
}
