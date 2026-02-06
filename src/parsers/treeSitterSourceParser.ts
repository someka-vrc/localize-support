import { SourceParser } from "./sourceParser";
import { LocalizationCall } from "./types";
import { extractFirstStringArgumentRange } from "../utils";
import { LanguageWasmMap } from "./languageMap";

// Tree-sitter integration is optional. If it fails to initialize or parse,
// this parser will throw from its methods so ParserManager falls back to
// other parsers (e.g., RegexSourceParser).

export class TreeSitterSourceParser implements SourceParser {
  private ready: boolean = false;
  private initPromise: Promise<void> | null = null;
  private Parser: any = null;
  private language: any = null;
  private parser: any = null;
  private queryStr: string | null = null;
  private wtsModule: any | null = null;
  private vscodeModule: any | null = null;

  // Accept optional modules for testing/injection
  constructor(private languageId: string = "csharp", wtsModule?: any, vscodeModule?: any) {
    this.wtsModule = wtsModule || null;
    this.vscodeModule = vscodeModule || null;
    const map = LanguageWasmMap[this.languageId];
    if (!map) {
      // unsupported language; parser will remain unready and throw on use
      return;
    }
    this.queryStr = map.query;
    // start async init but do not block construction
    this.initPromise = this.init().catch(() => {
      this.ready = false;
    });
  }

  private async init() {
    if (this.ready) {
      return;
    }
    // dynamically import web-tree-sitter (optional dependency)
    let WTS: any;
    try {
      WTS = this.wtsModule || require("web-tree-sitter");
    } catch (e) {
      // web-tree-sitter not available
      throw new Error("web-tree-sitter not available");
    }
    if (!WTS.init || typeof WTS.init !== 'function') {
      throw new Error('web-tree-sitter init function missing');
    }
    await WTS.init();

    const map = LanguageWasmMap[this.languageId];
    if (!map) {
      throw new Error("unsupported language");
    }

    let cdnBase = "https://unpkg.com/tree-sitter-wasms@latest/out/";
    try {
      // avoid hard dependency on vscode module for unit tests
      const vscode = this.vscodeModule || require('vscode');
      const cfg = vscode.workspace.getConfiguration().get("poDotnet.wasmCdnBaseURL");
      if (typeof cfg === 'string' && cfg.length > 0) {
        cdnBase = cfg;
      }
    } catch (e) {
      // running in unit tests / non-vscode env — keep default CDN base
    }
    const wasmUrl = cdnBase.endsWith("/") ? cdnBase + map.wasmName : cdnBase + "/" + map.wasmName;

    // Try to load language from remote URL. This may redirect; web-tree-sitter may support loading via URL.
    try {
      this.language = await WTS.Language.load(wasmUrl);
      this.Parser = WTS;
      this.parser = new WTS.Parser();
      this.parser.setLanguage(this.language);
      this.ready = true;
    } catch (e) {
      throw new Error("failed to load tree-sitter language: " + String(e));
    }
  }

  private ensureReady() {
    if (this.ready) {
      return;
    }
    // if initPromise exists, throw to indicate not ready yet — ParserManager will fallback
    throw new Error("Tree-sitter parser not ready");
  }

  findAllLocalizationCalls(text: string, funcs: string[] = ["G"]): LocalizationCall[] {
    // ensure initialized
    this.ensureReady();
    const res: LocalizationCall[] = [];
    if (!this.queryStr) {
      return res;
    }

    const tree = this.parser.parse(text);
    const Query = this.Parser.Query;
    const q = new Query(this.language, this.queryStr);
    const captures = q.captures(tree.rootNode);
    // captures is array of { name, node }
    // We look for pairs where name is 'func-name' and 'args'
    for (let i = 0; i < captures.length; i++) {
      const cap: any = captures[i];
      if (cap.name === "func-name") {
        const funcNode = cap.node;
        const funcName = funcNode.text;
        // find following args capture
        const next: any | undefined = captures.slice(i + 1).find((c: any) => c.name === "args");
        if (!next) {
          continue;
        }
        const argsNode = next.node;
        const insideStart = argsNode.startIndex; // opening paren index + 1? args node spans the parens content
        const insideText = text.substring(insideStart, argsNode.endIndex);
        const arg = extractFirstStringArgumentRange(insideText, insideStart);
        if (!arg) {
          continue;
        }
        res.push({ msgid: arg.msgid, start: arg.start, end: arg.end, callStart: funcNode.startIndex, callEnd: argsNode.endIndex, funcName });
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
