import * as vscode from "vscode";
import {
  IWorkspaceService,
  MyFileStat,
  MyConfiguration,
  Disposable,
  MyRelativePattern,
  MyConfigurationChangeEvent,
  MyFileType,
} from "./vscTypes";
import { URI } from "vscode-uri";

/**
 * vscode API をラップして IWorkspaceService に適合させる本番用実装
 */
export class VSCodeWorkspaceService implements IWorkspaceService {
  // --- ヘルパーメソッド ---


  private toVscPattern(
    pattern: string | MyRelativePattern,
  ): string | vscode.RelativePattern {
    if (typeof pattern === "string") {
      return pattern;
    }
    return new vscode.RelativePattern(
      pattern.baseUri as vscode.Uri,
      pattern.pattern,
    );
  }

  // --- IWorkspaceService の実装 ---

  async findFiles(pattern: string | MyRelativePattern): Promise<URI[]> {
    const files = await vscode.workspace.findFiles(this.toVscPattern(pattern));
    return files as unknown as URI[];
  }

  async readFile(uri: URI): Promise<Uint8Array> {
    return await vscode.workspace.fs.readFile(uri as vscode.Uri);
  }

  async writeFile(uri: URI, content: Uint8Array): Promise<void> {
    return await vscode.workspace.fs.writeFile(uri as vscode.Uri, content);
  }

  async deleteFile(uri: URI): Promise<void> {
    return await vscode.workspace.fs.delete(uri as vscode.Uri);
  }

  async stat(uri: URI): Promise<MyFileStat> {
    const stats = await vscode.workspace.fs.stat(uri as vscode.Uri);
    return {
      type: stats.type as unknown as MyFileType,
      ctime: stats.ctime,
      mtime: stats.mtime,
      size: stats.size,
    };
  }

  async validateDirectoryPath(uri: URI): Promise<boolean> {
    try {
      const stats = await this.stat(uri);
      return stats.type === MyFileType.Directory;
    } catch {
      return false;
    }
  }

  async getTextDocumentContent(uri: URI): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(uri as vscode.Uri);
    return doc.getText();
  }

  getWorkspaceFolders(): { uri: URI; name: string; index: number }[] {
    return (vscode.workspace.workspaceFolders || []).map((f) => ({
      uri: f.uri as unknown as URI,
      name: f.name,
      index: f.index,
    }));
  }

  getConfiguration(section: string, scope?: URI): MyConfiguration {
    const config = vscode.workspace.getConfiguration(
      section,
      scope ? scope as vscode.Uri : undefined,
    );
    return {
      get: <T>(key: string): T | undefined => config.get<T>(key),
    };
  }

  async createDirectory(uri: URI): Promise<void> {
    return vscode.workspace.fs.createDirectory(uri as vscode.Uri);
  }

  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable {
    return vscode.workspace.onDidChangeTextDocument((e) => {
      callback(e.document.uri as unknown as URI);
    });
  }

  onDidChangeConfiguration(
    callback: (e: MyConfigurationChangeEvent) => void,
  ): Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      callback({
        affectsConfiguration: (section, scope) =>
          e.affectsConfiguration(
            section,
            scope ? scope as vscode.Uri : undefined,
          ),
      });
    });
  }

  createFileSystemWatcher(
    pattern: string | MyRelativePattern,
    callback: (type: "created" | "changed" | "deleted", uri: URI) => void,
  ): Disposable {
    const vscPattern = this.toVscPattern(pattern);
    const watcher = vscode.workspace.createFileSystemWatcher(vscPattern);

    const subs = [
      watcher.onDidCreate((uri) => callback("created", uri as unknown as URI)),
      watcher.onDidChange((uri) => callback("changed", uri as unknown as URI)),
      watcher.onDidDelete((uri) => callback("deleted", uri as unknown as URI)),
    ];

    return {
      dispose: () => {
        subs.forEach((s) => s.dispose());
        watcher.dispose();
      },
    };
  }

  createDiagnosticCollection(name: string): vscode.DiagnosticCollection {
    return vscode.languages.createDiagnosticCollection(name);
  }
}
