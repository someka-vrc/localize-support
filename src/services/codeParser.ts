import { URI } from "vscode-uri";
import Parser from "web-tree-sitter";
import { CodeLanguage, L10nCode } from "../models/l10nTypes";
import { WasmDownloader } from "./wasmDownloader";
import { vscTypeHelper } from "../models/vscTypes";

/**
 * Lightweight code parser using tree-sitter.
 * - Parser.init() is performed once per process.
 * - Loaded Languages are cached by (language).
 * - Returns only string literal keys (supports plain strings and simple template strings).
 */
export class CodeParser {
  // initialize Parser once for the lifetime of the process
  private static parserInitPromise: Promise<void> | null = null;
  private static languageCache: Map<CodeLanguage, Parser.Language> = new Map();

  constructor(
    private wasmDownloader: WasmDownloader,
    private language: CodeLanguage,
  ) {}

  private static async ensureParserInitialized(): Promise<void> {
    if (!CodeParser.parserInitPromise) {
      CodeParser.parserInitPromise = Parser.init();
    }
    return CodeParser.parserInitPromise;
  }

  private static escapeForRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async parse(l10nFuncNames: string[], wasmCdnBaseUrl: string, content: string, uri: URI): Promise<L10nCode[]> {
    // input validation
    if (l10nFuncNames.length === 0) {
      throw new Error("l10nFuncNames must be a non-empty array");
    }

    await CodeParser.ensureParserInitialized();

    // load/cached language
    let loadedLanguage: Parser.Language | undefined = CodeParser.languageCache.get(this.language);
    try {
      if (!loadedLanguage) {
        const uri = await this.wasmDownloader.retrieveWasmFile(wasmCdnBaseUrl, this.language);
        // pass a filesystem path (not a file:// URI string) — Language.load expects a file path
        loadedLanguage = await Parser.Language.load(uri.fsPath);
        CodeParser.languageCache.set(this.language, loadedLanguage);
      }
    } catch (err) {
      // fail-safe: log and return empty list rather than throwing internal parser errors
      console.warn(`CodeParser: failed to load language for ${this.language}:`, err);
      return [];
    }

    const queryStr = this.getTreeSitterQuery(this.language, l10nFuncNames);
    if (!queryStr || !queryStr.trim()) {
      return [];
    }

    // perform parse
    try {
      const parser = new Parser();
      parser.setLanguage(loadedLanguage);
      const tree = parser.parse(content);
      if (!tree) {
        return [];
      }
      const query = loadedLanguage.query(queryStr);
      const captures = query
        .captures(tree.rootNode)
        .map((capture) => {
          const node = capture.node;
          if (capture.name !== "l10nKey") {
            return null;
          }

          // node.text may be:
          // - 'single-quoted'
          // - "double-quoted"
          // - `template` or `template ${expr}` (we only accept simple templates here)
          const text = node.text;
          if (!text || text.length < 2) {
            return null;
          }

          // Ignore call sites where the function is accessed via a computed/subscript
          // property (e.g. obj['t'](...)). Find the nearest call-like ancestor and
          // look for a '[' before the argument list — if present, treat as computed.
          let anc: Parser.SyntaxNode | null = node;
          while (anc && !["call_expression", "call", "invocation_expression", "method_invocation"].includes(anc.type)) {
            anc = anc.parent;
          }
          if (anc && typeof anc.text === "string") {
            const callText = anc.text;
            const parenIdx = callText.indexOf("(");
            const bracketIdx = callText.indexOf("[");
            if (bracketIdx !== -1 && parenIdx !== -1 && bracketIdx < parenIdx) {
              return null; // computed property access — ignore
            }
          }

          // Reject template/interpolated strings containing expressions.
          // For template/f-string fragments the immediate captured node may be
          // only the literal fragment (without `${}` or `f` prefix), so inspect
          // surrounding ancestor nodes when necessary.

          // JavaScript / TypeScript: if this fragment is inside a template_string
          // that contains `${`, skip it (we don't accept templates with expressions).
          if (this.language === "javascript" || this.language === "typescript") {
            let a: Parser.SyntaxNode | null = node;
            while (a && a.type !== "template_string") {
              a = a.parent;
            }
            if (a && a.text && a.text.includes("${")) {
              return null;
            }
          }

          // Python: attempt to detect f-strings by locating the opening quote in
          // the original source `content`. The captured node may be a fragment
          // (without the leading `f`), so inspect the source text before the
          // fragment start to see if the string token has an `f` prefix.
          if (this.language === "python") {
            const lines = content.split(/\r?\n/);
            let offset = 0;
            for (let i = 0; i < node.startPosition.row; i++) {
              offset += lines[i].length + 1; // include newline
            }
            offset += node.startPosition.column;

            // scan backwards for the opening quote
            let qi = offset - 1;
            while (qi >= 0 && content[qi] !== '"' && content[qi] !== "'") {
              qi--;
            }

            // DEBUG: if we couldn't find the quote, log context to help diagnosis
            if (qi < 0) {
              /* istanbul ignore next: debug-only branch */
              console.debug("CodeParser: python f-string detection — no opening quote found", {
                snippet: content.slice(Math.max(0, offset - 30), offset + 30),
                startPos: node.startPosition,
              });
            }

            if (qi >= 0) {
              const prefixStart = Math.max(0, qi - 3);
              const prefix = content.slice(prefixStart, qi).trim();
              if (/^[fF]/.test(prefix) || content.slice(qi, offset).includes("{")) {
                return null; // detected an f-string or interpolation
              }
            }

            // additional safety: if any ancestor node text contains a '{', it's
            // very likely an f-string with interpolations — skip.
            let aa: Parser.SyntaxNode | null = node.parent;
            while (aa && aa.type !== "call") {
              if (typeof aa.text === "string" && aa.text.includes("{")) {
                return null;
              }
              aa = aa.parent;
            }
          }

          // C#: interpolated strings start with `$` — reject them early
          if (this.language === "csharp" && text.startsWith("$")) {
            return null;
          }

          // strip known string prefixes used in some languages (C# verbatim/interpolated)
          let normalized = text.replace(/^[@$]+/, "");
          // strip surrounding quotes/backticks when possible
          const key =
            normalized.startsWith("`") || normalized.startsWith("'") || normalized.startsWith('"')
              ? normalized.slice(1, -1)
              : normalized;

          if (!key) {
            return null;
          }

          const range = vscTypeHelper.newRange(
            node.startPosition.row,
            node.startPosition.column,
            node.endPosition.row,
            node.endPosition.column,
          );
          const location = vscTypeHelper.newLocation(uri, range);
          return { key, location } as L10nCode;
        })
        .filter((item): item is L10nCode => item !== null);

      return captures;
    } catch (err) {
      console.warn("CodeParser.parse failed:", err);
      return [];
    }
  }

  getTreeSitterQuery(language: CodeLanguage, l10nFuncNames: string[]): string {
    const funcPattern = l10nFuncNames.map((n) => CodeParser.escapeForRegex(n)).join("|");

    // NOTE: queries try to be permissive and match both bare identifier calls and member calls
    switch (language) {
      case "javascript":
      case "typescript":
        return `
        (call_expression
          function: [
            (identifier) @funcName (#match? @funcName "^(${funcPattern})$")
            (member_expression
              property: (property_identifier) @method_name (#match? @method_name "^(${funcPattern})$")
            )
          ]
          arguments: (arguments
            .
            [
              (string (string_fragment) @l10nKey)
              (template_string (string_fragment) @l10nKey)
            ]
          )
        )
      `;

      case "python":
        return `
        (call
          function: [
            (identifier) @funcName (#match? @funcName "^(${funcPattern})$")
            (attribute
              attribute: (identifier) @attr_name (#match? @attr_name "^(${funcPattern})$")
            )
          ]
          arguments: (argument_list
            .
            (string (string_content) @l10nKey)
          )
        )
      `;

      case "csharp":
        // some C# grammars wrap literal values in `argument` nodes; match that structure
        return `
        (invocation_expression
          function: [
            (identifier) @funcName (#match? @funcName "^(${funcPattern})$")
            (member_access_expression
              name: (identifier) @member_name (#match? @member_name "^(${funcPattern})$")
            )
          ]
          arguments: (argument_list
            .
            [
              (argument (string_literal) @l10nKey)
              (argument (verbatim_string_literal) @l10nKey)
            ]
          )
        )
      `;

      case "java":
        // Java string literals are represented as string_literal nodes in most grammars
        return `
        (method_invocation
          name: (identifier) @funcName (#match? @funcName "^(${funcPattern})$")
          arguments: (argument_list
            .
            (string_literal) @l10nKey
          )
        )
        (method_invocation
          object: (_)
          name: (identifier) @method_name (#match? @method_name "^(${funcPattern})$")
          arguments: (argument_list
            .
            (string_literal) @l10nKey
          )
        )
      `;

      default:
        return "";
    }
  }
}
