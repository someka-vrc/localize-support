import * as vscode from "vscode";
import * as path from "path";
import { parsePo } from "../utils";

export class POManager {
  private cache = new Map<string, Map<string, {translation: string; line: number}>>(); // uri -> map
  private watchers = new Map<string, vscode.FileSystemWatcher>(); // dir -> watcher
  private _onDidChange = new vscode.EventEmitter<{ uri: string }>();
  public readonly onDidChange = this._onDidChange.event;
  constructor(private context: vscode.ExtensionContext) {
    // Watch open/changed/closed text documents for in-memory edits of .po files
    // so that unsaved changes in editors are reflected in the cached PO entries.
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.fsPath.endsWith(".po")) {
          try {
            const map = parsePo(doc.getText());
            this.cache.set(doc.uri.toString(), map);
            this._onDidChange.fire({ uri: doc.uri.toString() });
          } catch (e) {
            // ignore parse errors from in-progress edits
          }
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const doc = e.document;
        if (doc.uri.fsPath.endsWith(".po")) {
          try {
            const map = parsePo(doc.getText());
            this.cache.set(doc.uri.toString(), map);
            this._onDidChange.fire({ uri: doc.uri.toString() });
          } catch (err) {
            // ignore parse errors while typing
          }
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath.endsWith(".po")) {
          // ensure we parse the saved content (in case watcher missed it)
          this.readAndParse(doc.uri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.fsPath.endsWith(".po")) {
          // restore cache from disk (or delete) when editor is closed
          this.readAndParse(doc.uri);
        }
      }),
    );
  }

  public dispose() {
    for (const w of this.watchers.values()) {
      w.dispose();
    }
    this.watchers.clear();
  }

  // Clear cached PO data and notify listeners so they can rescan.
  public clearCache() {
    this.cache.clear();
    // Fire change event without a specific uri to indicate global change and trigger a full rescan.
    this._onDidChange.fire({ uri: "" });
  }

  public async ensureDirs(
    dirs: string[],
    workspaceFolder: vscode.WorkspaceFolder | null,
  ) {
    if (!workspaceFolder) {
      return;
    }
    for (const dir of dirs) {
      if (this.watchers.has(dir)) {
        continue;
      }
      try {
        const rel = path
          .relative(workspaceFolder.uri.fsPath, dir)
          .replace(/\\/g, "/");
        const pattern = new vscode.RelativePattern(
          workspaceFolder,
          rel + "/**/*.po",
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.context.subscriptions.push(watcher);
        watcher.onDidCreate((uri) => this.readAndParse(uri));
        watcher.onDidChange((uri) => this.readAndParse(uri));
        watcher.onDidDelete((uri) => {
          this.cache.delete(uri.toString());
          this._onDidChange.fire({ uri: uri.toString() });
        });
        this.watchers.set(dir, watcher);
        await this.scanDir(dir, workspaceFolder);
      } catch (e) {
        console.error("po-dotnet: failed to watch/scan dir", dir, e);
      }
    }
  }

  private async scanDir(
    dir: string,
    workspaceFolder: vscode.WorkspaceFolder,
  ) {
    try {
      const rel = path
        .relative(workspaceFolder.uri.fsPath, dir)
        .replace(/\\/g, "/");
      const pattern = new vscode.RelativePattern(
        workspaceFolder,
        rel + "/**/*.po",
      );
      const uris = await vscode.workspace.findFiles(pattern);
      for (const uri of uris) {
        await this.readAndParse(uri);
      }
    } catch (e) {
      console.error("po-dotnet: error scanning dir", dir, e);
    }
  }

  private async readAndParse(uri: vscode.Uri) {
    try {
      // If the file is open in an editor, prefer its buffer to avoid
      // overwriting unsaved in-memory changes.
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (openDoc) {
        try {
          const map = parsePo(openDoc.getText());
          this.cache.set(uri.toString(), map);
          this._onDidChange.fire({ uri: uri.toString() });
          return;
        } catch (e) {
          // ignore parse errors from in-progress edits and fallback to disk read
        }
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder("utf-8").decode(bytes);
      const map = parsePo(content);
      this.cache.set(uri.toString(), map);
      this._onDidChange.fire({ uri: uri.toString() });
    } catch (e) {
      console.error("Error reading/parsing PO file", uri.toString(), e);
      this.cache.delete(uri.toString());
      this._onDidChange.fire({ uri: uri.toString() });
    }
  }

  private pathIsUnder(child: string, parent: string) {
    const c = path.normalize(path.resolve(child));
    const p = path.normalize(path.resolve(parent));
    return c === p || c.startsWith(p + path.sep);
  }

  public getEntryStatus(msgid: string, allowedDirs?: string[]) {
    const results: Array<{
      uri: vscode.Uri;
      relativePath: string;
      hasEntry: boolean;
      translation: string | undefined;
      line?: number;
    }> = [];
    for (const [uriStr, map] of this.cache) {
      const uri = vscode.Uri.parse(uriStr);
      if (allowedDirs && allowedDirs.length > 0) {
        let ok = false;
        for (const d of allowedDirs) {
          if (this.pathIsUnder(uri.fsPath, d)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          continue;
        }
      }
      const wsFolder = (vscode.workspace && typeof (vscode.workspace as any).getWorkspaceFolder === 'function') ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
      const relativePath = wsFolder
        ? path.relative(wsFolder.uri.fsPath, uri.fsPath)
        : uri.fsPath;
      const entry = map.get(msgid);
      const has = !!entry;
      const translation = has ? entry!.translation : undefined;
      const line = has ? entry!.line : undefined;
      results.push({ uri, relativePath, hasEntry: has, translation, line });
    }
    return results;
  }

  public getTranslations(msgid: string, allowedDirs?: string[]) {
    const results: Array<{
      uri: vscode.Uri;
      relativePath: string;
      translation: string;
      line: number;
    }> = [];
    for (const [uriStr, map] of this.cache) {
      const uri = vscode.Uri.parse(uriStr);
      if (allowedDirs && allowedDirs.length > 0) {
        let ok = false;
        for (const d of allowedDirs) {
          if (this.pathIsUnder(uri.fsPath, d)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          continue;
        }
      }
      const entry = map.get(msgid);
      if (entry && entry.translation !== undefined && entry.translation !== "") {
        const wsFolder = (vscode.workspace && typeof (vscode.workspace as any).getWorkspaceFolder === 'function') ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
        const relativePath = wsFolder
          ? path.relative(wsFolder.uri.fsPath, uri.fsPath)
          : uri.fsPath;
        results.push({ uri, relativePath, translation: entry.translation, line: entry.line });
      }
    }
    return results;
  }

  // Return a set of all msgids currently cached across PO files
  public getAllMsgids(allowedDirs?: string[]) {
    const set = new Set<string>();
    for (const [uriStr, map] of this.cache) {
      const uri = vscode.Uri.parse(uriStr);
      if (allowedDirs && allowedDirs.length > 0) {
        let ok = false;
        for (const d of allowedDirs) {
          if (this.pathIsUnder(uri.fsPath, d)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          continue;
        }
      }
      for (const k of map.keys()) {
        set.add(k);
      }
    }
    return set;
  }

  public getPOFileUris(allowedDirs?: string[]) {
    const uris: vscode.Uri[] = [];
    for (const uriStr of this.cache.keys()) {
      const uri = vscode.Uri.parse(uriStr);
      if (allowedDirs && allowedDirs.length > 0) {
        let ok = false;
        for (const d of allowedDirs) {
          if (this.pathIsUnder(uri.fsPath, d)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          continue;
        }
      }
      uris.push(uri);
    }
    return uris;
  }

  // Return parsed PO entries for a specific PO file (id -> translation + line)
  public getEntriesForFile(uri: vscode.Uri) {
    const map = this.cache.get(uri.toString());
    if (!map) { return [] as Array<{ id: string; translation: string | undefined; line: number }>; }
    const res: Array<{ id: string; translation: string | undefined; line: number }> = [];
    for (const [k, v] of map.entries()) {
      res.push({ id: k, translation: v.translation, line: v.line });
    }
    return res;
  }
}
