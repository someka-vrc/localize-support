import { Utils, URI } from "vscode-uri";
import * as vscode from "vscode";

export type Disposable = { dispose(): void };
// types.ts などの共通ファイルに定義
export interface MyPosition {
  readonly line: number;
  readonly character: number;
}

export interface MyRange {
  readonly start: MyPosition;
  readonly end: MyPosition;
}

export interface MyLocation {
  readonly uri: URI;
  readonly range: MyRange;
}

export enum MyDiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}
export interface MyDiagnostic {
  range: MyRange;
  message: string;
  severity: MyDiagnosticSeverity;
}

export type DiagnosticCollection = vscode.DiagnosticCollection;

export enum MyFileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface MyFileStat {
  type: MyFileType;
  ctime: number;
  mtime: number;
  size: number;
}
export interface MyRelativePattern {
  baseUri: URI;
  pattern: string;
}

export interface MyConfigurationChangeEvent {
  /** 指定したセクションが変更されたかどうかを判定する */
  affectsConfiguration(section: string, scope?: URI): boolean;
}

interface LogOutputChannel {
  trace(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(error: string | Error, ...args: any[]): void;
}

export interface IWorkspaceService {
  // ファイル操作
  findFiles(pattern: string | MyRelativePattern): Promise<URI[]>;
  readFile(uri: URI): Promise<Uint8Array>;
  writeFile(uri: URI, content: Uint8Array): Promise<void>;
  deleteFile(uri: URI): Promise<void>;
  stat(uri: URI): Promise<MyFileStat>;
  /**
   * Validate whether the given uri is a directory.
   * @param uri The uri to validate.
   * @returns True if the uri is a directory; otherwise, false.
   */
  validateDirectoryPath(uri: URI): Promise<boolean>;
  /** openTextDocument().getText() の代わり */
  getTextDocumentContent(uri: URI): Promise<string>;

  // 設定・フォルダ
  getWorkspaceFolders(): { uri: URI; name: string; index: number }[];
  getConfiguration(section: string, scope?: URI): MyConfiguration;
  createDirectory(uri: URI): Promise<void>;

  // 監視 (Event Listeners)
  /** ドキュメントが開かれたり、メモリ上で編集された時のイベント */
  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable;
  /** 設定が変更された時のイベント */
  onDidChangeConfiguration(callback: (e: MyConfigurationChangeEvent) => void): Disposable;

  // --- ディスク監視 (FileSystemWatcher) ---
  /** ディスク上のファイル作成・変更・削除を監視する */
  createFileSystemWatcher(
    pattern: string | MyRelativePattern,
    callback: (type: "created" | "changed" | "deleted", uri: URI) => void,
  ): Disposable;

  createDiagnosticCollection(name: string): DiagnosticCollection;

  logger: LogOutputChannel;
}

export interface MyConfiguration {
  get<T>(key: string): T | undefined;
}

function newPosition(line: number, character: number): MyPosition {
  return { line, character };
}
function newRangeFromPos(start: MyPosition, end: MyPosition): MyRange {
  return { start, end };
}
function newRange(startLine: number, startChar: number, endLine: number, endChar: number): MyRange {
  return newRangeFromPos(newPosition(startLine, startChar), newPosition(endLine, endChar));
}
function newLocation(uri: URI, range: MyRange): MyLocation {
  return { uri, range };
}
function newDiagnostic(range: MyRange, message: string, severity: MyDiagnosticSeverity): MyDiagnostic {
  return { range, message, severity };
}

export const vscTypeHelper = {
  newPosition,
  newRangeFromPos,
  newRange,
  newLocation,
  newDiagnostic,
};
