import { SourceParser } from "./sourceParser";
import { LocalizationCall } from "./types";
import { extractFirstStringArgumentRange, unescapePo } from "../utils";

export class RegexSourceParser implements SourceParser {
  findAllLocalizationCalls(text: string, funcs: string[] = ["G"]): LocalizationCall[] {
    const res: LocalizationCall[] = [];
    if (!funcs || funcs.length === 0) {
      funcs = ["G"];
    }
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const re = new RegExp(`\\b(?:${funcs.map(escapeRegExp).join("|")})\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const matchIndex = match.index;
      let i = matchIndex + match[0].length;
      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }
      if (i >= text.length || text[i] !== '(') {
        continue;
      }
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        const ch = text[j];
        if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
          if (depth === 0) {
            const inside = text.substring(i + 1, j);
            const arg = extractFirstStringArgumentRange(inside, i + 1);
            if (!arg) {
              break;
            }
            res.push({ msgid: arg.msgid, start: arg.start, end: arg.end, callStart: matchIndex, callEnd: j + 1, funcName: match[0] });
            break;
          }
        }
      }
    }
    return res;
  }

  findLocalizationCallAtOffset(text: string, offset: number, funcs: string[] = ["G"]) {
    const calls = this.findAllLocalizationCalls(text, funcs);
    for (const c of calls) {
      if (offset >= c.start && offset < c.end) {
        return c;
      }
    }
    return null;
  }
}
