import { Uri, Diagnostic } from "vscode";
import {
  IWorkspaceService,
  MyFileStat,
  MyConfiguration,
  Disposable,
  MyRelativePattern,
  MyConfigurationChangeEvent,
  MyFileType,
  DiagnosticCollection,
} from "../../../models/vscTypes";
import { URI } from "vscode-uri";

/**
 * IWorkspaceService のモッククラス。
 */
export class MockWorkspaceService implements IWorkspaceService {
  // --- ファイル操作 ---

  async findFiles(pattern: string | MyRelativePattern): Promise<URI[]> {
    return [];
  }

  async readFile(uri: URI): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async writeFile(uri: URI, content: Uint8Array): Promise<void> {
    return;
  }

  async deleteFile(uri: URI): Promise<void> {
    return;
  }

  async stat(uri: URI): Promise<MyFileStat> {
    return {
      type: MyFileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
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
    return "";
  }

  // --- 設定・フォルダ ---

  getWorkspaceFolders(): { uri: URI; name: string; index: number }[] {
    return [];
  }

  getConfiguration(section: string, scope?: URI): MyConfiguration {
    return {
      get: <T>(key: string): T | undefined => undefined,
    };
  }

  async createDirectory(uri: URI): Promise<void> {
    return;
  }

  // --- 監視 (Event Listeners) ---

  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable {
    return { dispose: () => {} };
  }

  onDidChangeConfiguration(
    callback: (e: MyConfigurationChangeEvent) => void,
  ): Disposable {
    return { dispose: () => {} };
  }

  createFileSystemWatcher(
    pattern: string | MyRelativePattern,
    callback: (type: "created" | "changed" | "deleted", uri: URI) => void,
  ): Disposable {
    return { dispose: () => {} };
  }

  createDiagnosticCollection(name: string): DiagnosticCollection {
    return new MockDiagnosticCollection(name);
  }
}

class MockDiagnosticCollection implements DiagnosticCollection {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  set(uri: unknown, diagnostics?: unknown): void {
    throw new Error("Method not implemented.");
  }
  delete(uri: Uri): void {
    throw new Error("Method not implemented.");
  }
  clear(): void {
    throw new Error("Method not implemented.");
  }
  forEach(
    callback: (
      uri: Uri,
      diagnostics: readonly Diagnostic[],
      collection: DiagnosticCollection,
    ) => any,
    thisArg?: any,
  ): void {
    throw new Error("Method not implemented.");
  }
  get(uri: Uri): readonly Diagnostic[] | undefined {
    throw new Error("Method not implemented.");
  }
  has(uri: Uri): boolean {
    throw new Error("Method not implemented.");
  }
  dispose(): void {
    throw new Error("Method not implemented.");
  }
  [Symbol.iterator](): Iterator<
    [uri: Uri, diagnostics: readonly Diagnostic[]],
    any,
    any
  > {
    throw new Error("Method not implemented.");
  }
}
