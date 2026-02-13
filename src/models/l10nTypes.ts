import { MyRange, MyLocation, MyDiagnostic } from "./vscTypes";
import { URI } from "vscode-uri";

/** 対応ローカライズ形式 */
export const L10nFormats = ["po"] as const;
/** 対応ローカライズ形式 */
export type L10nFormat = (typeof L10nFormats)[number];
/** 対応コード言語 */
export const CodeLanguages = [
  "csharp",
  "javascript",
  "typescript",
  "python",
  "java",
] as const;
/** 対応コード言語 */
export type CodeLanguage = (typeof CodeLanguages)[number];

/** ローカライズエントリ */
export type L10nEntry = {
  translation: string;
  location: MyLocation;
};

export type L10nLangEntries = {
  [key: string]: L10nEntry;
}

export type L10nEntries = {
  [lang: string]: L10nLangEntries;
}

/** ローカライズ関数呼び出し */
export type L10nCode = {
  key: string;
  range: MyRange;
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
  /** ローカライズエントリ */
  l10nEntries: L10nEntries;
  /** ローカライズ関数呼び出し */
  codes: L10nCode[];
  diagnostics: MyDiagnostic[];
};