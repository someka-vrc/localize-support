import {
  IWorkspaceWrapper,
  ICommandWrapper,
  IWindowWrapper,
  ILanguagesWrapper,
  FileStat,
  WorkspaceConfiguration,
  Disposable,
  MyRelativePattern,
  MyConfigurationChangeEvent,
  FileType,
  DiagnosticCollection,
  MyRange,
  FileSystemWatcher,
  IFileSystemWrapper,
  LogLevel,
  LogOutputChannel,
} from "../../../models/vscTypes";
import { Event as vtEvent } from "../../../models/vscTypes";
import { URI } from "vscode-uri";

export class MockFileSystemWrapper implements IFileSystemWrapper {
  readFile(uri: URI): Promise<Uint8Array> {
    return Promise.reject(new Error("MockFileSystemWrapper.readFile not stubbed"));
  }
  writeFile(uri: URI, content: Uint8Array): Promise<void> {
    return Promise.reject(new Error("MockFileSystemWrapper.writeFile not stubbed"));
  }
  deleteFile(uri: URI): Promise<void> {
    return Promise.reject(new Error("MockFileSystemWrapper.deleteFile not stubbed"));
  }
  stat(uri: URI): Promise<FileStat> {
    return Promise.reject(new Error("MockFileSystemWrapper.stat not stubbed"));
  }
  validateDirectoryPath(uri: URI): Promise<boolean> {
    return Promise.reject(new Error("MockFileSystemWrapper.validateDirectoryPath not stubbed"));
  }
  createDirectory(uri: URI): Promise<void> {
    return Promise.reject(new Error("MockFileSystemWrapper.createDirectory not stubbed"));
  }
}
export class MockWorkspaceWrapper implements IWorkspaceWrapper {
  fs: IFileSystemWrapper = new MockFileSystemWrapper();
  findFiles(pattern: string | MyRelativePattern): Promise<URI[]> {
    return Promise.reject(new Error("MockWorkspaceWrapper.findFiles not stubbed"));
  }
  getTextDocumentContent(uri: URI): Promise<string> {
    return Promise.reject(new Error("MockWorkspaceWrapper.getTextDocumentContent not stubbed"));
  }
  getWorkspaceFolders(): { uri: URI; name: string; index: number }[] {
    throw new Error("MockWorkspaceWrapper.getWorkspaceFolders not stubbed");
  }
  getConfiguration(section: string, scope?: URI): WorkspaceConfiguration {
    throw new Error("MockWorkspaceWrapper.getConfiguration not stubbed");
  }
  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable {
    throw new Error("MockWorkspaceWrapper.onDidChangeTextDocument not stubbed");
  }
  onDidChangeConfiguration(callback: (e: MyConfigurationChangeEvent) => void): Disposable {
    throw new Error("MockWorkspaceWrapper.onDidChangeConfiguration not stubbed");
  }
  createFileSystemWatcher(pattern: string | MyRelativePattern): FileSystemWatcher {
    throw new Error("MockWorkspaceWrapper.createFileSystemWatcher not stubbed");
  }
}
export class MockCommandWrapper implements ICommandWrapper {
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    throw new Error(`MockCommandWrapper.registerCommand not stubbed: ${command}`);
  }
}
/**
 * A channel for containing log output.
 *
 * To get an instance of a `LogOutputChannel` use
 * {@link window.createOutputChannel createOutputChannel}.
 */
export class MockLogOutputChannel implements LogOutputChannel {
  name: string;
  /**
   * The current log level of the channel. Defaults to {@link env.logLevel editor log level}.
   */
  readonly logLevel: LogLevel;

  /**
   * An {@link Event} which fires when the log level of the channel changes.
   */
  readonly onDidChangeLogLevel: vtEvent<LogLevel>;

  constructor(name: string = "mock") {
    this.name = name;
    this.logLevel = 1;
    this.onDidChangeLogLevel = () => {
      return { dispose: () => {} };
    };
  }

  append(value: string): void {}
  appendLine(value: string): void {}
  replace(value: string): void {}
  clear(): void {}
  show(column?: unknown, preserveFocus?: unknown): void {}
  hide(): void {}
  dispose(): void {}

  trace(message: string, ...args: any[]): void {
    console.debug(message, ...args);
  }
  debug(message: string, ...args: any[]): void {
    console.debug(message, ...args);
  }
  info(message: string, ...args: any[]): void {
    console.info(message, ...args);
  }
  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }
  error(error: string | Error, ...args: any[]): void {
    console.error(error, ...args);
  }
}
export class MockIWindowWrapper implements IWindowWrapper {
  showTextDocument(uri: URI, options?: { selection?: MyRange }): Promise<void> {
    return Promise.reject(new Error("MockIWindowWrapper.showTextDocument not stubbed"));
  }
  get logger(): LogOutputChannel {
    return new MockLogOutputChannel();
  }
}
export class MockILanguagesWrapper implements ILanguagesWrapper {
  createDiagnosticCollection(name: string): DiagnosticCollection {
    throw new Error("MockILanguagesWrapper.createDiagnosticCollection not stubbed");
  }
}
