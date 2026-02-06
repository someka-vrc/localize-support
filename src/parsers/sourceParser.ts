import { LocalizationCall } from "./types";

export interface SourceParser {
  findAllLocalizationCalls(text: string, funcs?: string[]): LocalizationCall[];
  findLocalizationCallAtOffset(text: string, offset: number, funcs?: string[]): LocalizationCall | null;
}
