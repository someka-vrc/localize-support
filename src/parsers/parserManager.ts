import { SourceParser } from "./sourceParser";
import { LocalizationCall } from "./types";

export class ParserManager implements SourceParser {
  private parsers: SourceParser[];

  constructor(parsers: SourceParser[] = []) {
    this.parsers = parsers;
  }

  setParsers(parsers: SourceParser[]) {
    this.parsers = parsers;
  }

  addParser(p: SourceParser) {
    this.parsers.push(p);
  }

  findAllLocalizationCalls(text: string, funcs?: string[]): LocalizationCall[] {
    for (const p of this.parsers) {
      try {
        const res = p.findAllLocalizationCalls(text, funcs);
        if (res && res.length > 0) {
          return res;
        }
      } catch (e) {
        // swallow and try next parser
        continue;
      }
    }
    // If none found or all empty, return empty array
    return [];
  }

  findLocalizationCallAtOffset(text: string, offset: number, funcs?: string[]) {
    // prefer result from first parser that yields a match
    for (const p of this.parsers) {
      try {
        const res = p.findLocalizationCallAtOffset(text, offset, funcs);
        if (res) {
          return res;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }
}
