import * as vscode from "vscode";
import * as path from "path";
import { parsePo } from "./utils";

export class POManager {
  private cache = new Map<string, Map<string, string>>(); // uri -> map
  private watchers = new Map<string, vscode.FileSystemWatcher>(); // dir -> watcher
  private _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;
  constructor(private context: vscode.ExtensionContext) {}

  public dispose() {
    for (const w of this.watchers.values()) {
      w.dispose();
    }
    this.watchers.clear();
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
          this._onDidChange.fire();
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
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder("utf-8").decode(bytes);
      const map = parsePo(content);
      this.cache.set(uri.toString(), map);
      this._onDidChange.fire();
    } catch (e) {
      console.error("Error reading/parsing PO file", uri.toString(), e);
      this.cache.delete(uri.toString());
      this._onDidChange.fire();
    }
  }

  public getEntryStatus(msgid: string) {
    const results: Array<{
      uri: vscode.Uri;
      relativePath: string;
      hasEntry: boolean;
      translation: string | undefined;
    }> = [];
    for (const [uriStr, map] of this.cache) {
      const uri = vscode.Uri.parse(uriStr);
      const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = wsFolder
        ? path.relative(wsFolder.uri.fsPath, uri.fsPath)
        : uri.fsPath;
      const has = map.has(msgid);
      const translation = has ? map.get(msgid) : undefined;
      results.push({ uri, relativePath, hasEntry: has, translation });
    }
    return results;
  }

  public getTranslations(msgid: string) {
    const results: Array<{
      uri: vscode.Uri;
      relativePath: string;
      translation: string;
    }> = [];
    for (const [uriStr, map] of this.cache) {
      const translation = map.get(msgid);
      if (translation && translation.trim() !== "") {
        const uri = vscode.Uri.parse(uriStr);
        const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
        const relativePath = wsFolder
          ? path.relative(wsFolder.uri.fsPath, uri.fsPath)
          : uri.fsPath;
        results.push({ uri, relativePath, translation });
      }
    }
    return results;
  }
}
