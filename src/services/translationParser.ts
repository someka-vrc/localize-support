import { MyDiagnostic } from "../models/vscTypes";
import { URI } from "vscode-uri";
import { L10nEntries, L10nFormats } from "../models/l10nTypes";
import { PoParser } from "./poParser";

export type TranslationParseResult = {
  entries: L10nEntries;
  success: boolean;
  diagnostics: MyDiagnostic[];
};

export interface TranslationParser {
  parse(uri: URI, content: string): Promise<TranslationParseResult>;
}

export function getL10nParser(format: string): TranslationParser | null {
  switch (format) {
    case "po":
      return new PoParser();
    // 他の形式のパーサーをここに追加
    default:
      return null;
  }
}