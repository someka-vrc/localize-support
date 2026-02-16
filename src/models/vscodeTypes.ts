import { Utils, URI } from "vscode-uri";
import * as vscode from "vscode";

export type Disposable = { dispose(): void };

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
  code?: string;
}

export const DiagnosticsCode = {
  // settings
  settingsInvalid: 'settings.invalid',

  // .po parser
  poMissingMsgstr: 'po.missingMsgstr',
  poEmptyMsgstr: 'po.emptyMsgstr',
  poDuplicateMsgid: 'po.duplicateMsgid',
  poInvalidMsgidFormat: 'po.invalidMsgidFormat',
  poInvalidMsgstrFormat: 'po.invalidMsgstrFormat',
  poUnexpectedContinuation: 'po.unexpectedContinuation',
  poUnrecognizedLine: 'po.unrecognizedLine',
  poParseError: 'po.parseError',

  // l10n matching
  undefinedKey: 'l10n.undefinedKey',
  unusedKey: 'l10n.unusedKey',
  missingTranslation: 'l10n.missingTranslation',
} as const;

export type DiagnosticsCodeType = typeof DiagnosticsCode[keyof typeof DiagnosticsCode];

export type DiagnosticCollection = vscode.DiagnosticCollection;

export type FileType = vscode.FileType;

export type FileStat = vscode.FileStat;
export interface MyRelativePattern {
  baseUri: URI;
  pattern: string;
}

export interface MyConfigurationChangeEvent {
  /** 指定したセクションが変更されたかどうかを判定する */
  affectsConfiguration(section: string, scope?: URI): boolean;
}

export type WorkspaceConfiguration = vscode.WorkspaceConfiguration;

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
function newDiagnostic(range: MyRange, message: string, severity: MyDiagnosticSeverity, code?: string): MyDiagnostic {
  return { range, message, severity, code };
}

export const vscTypeHelper = {
  newPosition,
  newRangeFromPos,
  newRange,
  newLocation,
  newDiagnostic,
};

export interface IFileSystemWrapper {
  readFile(uri: URI): Promise<Uint8Array>;
  writeFile(uri: URI, content: Uint8Array): Promise<void>;
  deleteFile(uri: URI): Promise<void>;
  stat(uri: URI): Promise<FileStat>;
  validateDirectoryPath(uri: URI): Promise<boolean>;
  createDirectory(uri: URI): Promise<void>;
}

export type FileSystemWatcher = vscode.FileSystemWatcher;
export interface IWorkspaceWrapper {
  fs: IFileSystemWrapper;
  findFiles(pattern: string | MyRelativePattern): Promise<URI[]>;
  getTextDocumentContent(uri: URI): Promise<string>;
  getWorkspaceFolders(): { uri: URI; name: string; index: number }[];
  getConfiguration(section: string, scope?: URI): WorkspaceConfiguration;
  onDidChangeTextDocument(callback: (uri: URI) => void): Disposable;
  onDidChangeConfiguration(callback: (e: MyConfigurationChangeEvent) => void): Disposable;
  createFileSystemWatcher(
    pattern: string | MyRelativePattern
  ): FileSystemWatcher ;
}

export interface ICommandWrapper {
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable;
}

export type LogLevel = vscode.LogLevel;
export type Event<T> = vscode.Event<T>;
export type LogOutputChannel = vscode.LogOutputChannel;
export interface Logger {
  getLogger(): LogOutputChannel;
}

export interface ILanguagesWrapper {
  createDiagnosticCollection(name: string): DiagnosticCollection;
}

export interface IVSCodeWrapper {
  readonly workspace: IWorkspaceWrapper;
  readonly command: ICommandWrapper;
  readonly languages: ILanguagesWrapper;
  readonly logger: LogOutputChannel;
}