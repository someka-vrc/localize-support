import { MyRange, MyLocation, MyDiagnostic } from "./vscTypes";
import { URI } from "vscode-uri";

/** 対応ローカライズ形式 */
export const L10nFormats = ["po"] as const;
/** 対応ローカライズ形式 */
export type L10nFormat = (typeof L10nFormats)[number];
/** 対応コード言語 */
export const CodeLanguages = ["csharp", "javascript", "typescript", "python", "java"] as const;
/** 対応コード言語 */
export type CodeLanguage = (typeof CodeLanguages)[number];

/**
 * Mapping: CodeLanguage -> primary file extension (used by glob patterns / doc selectors)
 * ※ 以前 `CodeManager` 内にあった `extMap` をここに移動しました。
 */
export const CodeLanguageFileExtMap: Map<CodeLanguage, string> = new Map([
  ["javascript", "js"],
  ["typescript", "ts"],
  ["python", "py"],
  ["csharp", "cs"],
  ["java", "java"],
]);

/** ローカライズエントリ */
export type L10nEntry = {
  translation: string;
  location: MyLocation;
};

export type L10nLangEntries = {
  [key: string]: L10nEntry;
};

export type L10nEntries = {
  [lang: string]: L10nLangEntries;
};

/** ローカライズ関数呼び出し（ファイル位置を含む） */
export type L10nCode = {
  key: string;
  location: MyLocation;
};

export type L10nTarget = {
  /** コード言語 */
  codeLanguages: CodeLanguage[];
  /** コードディレクトリ */
  codeDirs: URI[];
  /** ローカライズ形式 */
  l10nFormat: L10nFormat;
  /** ローカライズディレクトリ */
  l10nDirs: URI[];
  /** ローカライズファイル拡張子 */
  l10nExtension: string;
  /** ローカライズ関数名 */
  l10nFuncNames: string[];
  /** 設定ファイルの場所 */
  settingsLocation: URI | number;
};
