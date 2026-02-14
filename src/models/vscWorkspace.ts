import * as vscode from "vscode";
import {
  IFileSystemWrapper,
  IWorkspaceWrapper,
  ICommandWrapper,
  IWindowWrapper,
  FileSystemWatcher,
  WorkspaceConfiguration,
  Disposable,
  MyRelativePattern,
  MyConfigurationChangeEvent,
  MyRange,
  DiagnosticCollection,
  FileStat,
  LogOutputChannel,
  IVSCodeWrapper,
  ILanguagesWrapper,
} from "./vscTypes";
import { URI } from "vscode-uri";

function toVscUri(uri: URI): vscode.Uri {
  return uri as vscode.Uri;
}

function toVscPattern(pattern: string | MyRelativePattern): string | vscode.RelativePattern {
  if (typeof pattern === "string") {
    return pattern;
  }
  return new vscode.RelativePattern(pattern.baseUri as vscode.Uri, pattern.pattern);
}

function toVscRange(range: MyRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

export class FileSystemWrapper implements IFileSystemWrapper {
  async readFile(uri: URI): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(toVscUri(uri));
  }
  async writeFile(uri: URI, content: Uint8Array): Promise<void> {
    return vscode.workspace.fs.writeFile(toVscUri(uri), content);
  }
  async deleteFile(uri: URI): Promise<void> {
    return vscode.workspace.fs.delete(toVscUri(uri));
  }
  async stat(uri: URI): Promise<FileStat> {
    return vscode.workspace.fs.stat(toVscUri(uri));
  }
  async validateDirectoryPath(uri: URI): Promise<boolean> {
    try {
      const stat = await this.stat(uri);
      return stat.type === vscode.FileType.Directory;
    } catch {
      return false;
    }
  }
  async createDirectory(uri: URI): Promise<void> {
    await vscode.workspace.fs.createDirectory(toVscUri(uri));
  }
}

export class WorkspaceWrapper implements IWorkspaceWrapper {
  fs: IFileSystemWrapper;
  constructor() {
    this.fs = new FileSystemWrapper();
  }
  async findFiles(pattern: string | MyRelativePattern): Promise<URI[]> {
    return vscode.workspace.findFiles(toVscPattern(pattern)).then((uris) => uris.map((u) => u as any as URI));
  }
  async getTextDocumentContent(uri: URI): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(toVscUri(uri));
    return doc.getText();
  }
  getWorkspaceFolders(): { uri: URI; name: string; index: number }[] {
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.map((f, i) => ({ uri: f.uri as any as URI, name: f.name, index: i }));
  }
  getConfiguration(section: string, scope?: URI): WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(section, scope ? (scope as any as vscode.Uri) : undefined);
  }

  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable {
    return vscode.workspace.onDidChangeTextDocument((e) => {
      callback(e.document.uri as any as URI);
    });
  }
  onDidChangeConfiguration(callback: (e: MyConfigurationChangeEvent) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      callback({
        affectsConfiguration: (section: string, scope?: URI) => {
          return e.affectsConfiguration(section, scope ? (scope as any as vscode.Uri) : undefined);
        },
      });
    });
  }
  createFileSystemWatcher(pattern: string | MyRelativePattern): FileSystemWatcher {
    return vscode.workspace.createFileSystemWatcher(toVscPattern(pattern));
  }
}

export class CommandWrapper implements ICommandWrapper {
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    return vscode.commands.registerCommand(command, callback);
  }
}


export class WindowWrapper implements IWindowWrapper {
  async showTextDocument(uri: URI, options?: { selection?: MyRange }): Promise<void> {
    const vscOptions: vscode.TextDocumentShowOptions = {};
    if (options?.selection) {
      vscOptions.selection = toVscRange(options.selection);
    }
    return vscode.window.showTextDocument(toVscUri(uri), vscOptions).then(() => {});
  }
  private _outputChannel: LogOutputChannel | null = null;
  get logger(): LogOutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel("localize-support", { log: true });
    }
    return this._outputChannel;
  }
}

export class LanguagesWrapper implements ILanguagesWrapper {
  createDiagnosticCollection(name: string): DiagnosticCollection {
    return vscode.languages.createDiagnosticCollection(name);
  }
}

export class VSCoderWrapper implements IVSCodeWrapper {
  workspace: IWorkspaceWrapper;
  command: ICommandWrapper;
  languages: ILanguagesWrapper;
  window: IWindowWrapper;
  constructor() {
    this.workspace = new WorkspaceWrapper();
    this.command = new CommandWrapper();
    this.window = new WindowWrapper();
    this.languages = new LanguagesWrapper();
  }
}
