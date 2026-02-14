import { MyDiagnostic, MyDiagnosticSeverity, vscTypeHelper } from "../models/vscTypes";
import { URI } from "vscode-uri";
import { TranslationParser, TranslationParseResult } from "./translationParser";
import { L10nLangEntries } from "../models/l10nTypes";
import * as path from "path";

export class PoParser implements TranslationParser {
  constructor() {}

  public async parse(uri: URI, content: string): Promise<TranslationParseResult> {
    const text = content.split("\n");
    const entries: L10nLangEntries = {};
    const diagnostics: MyDiagnostic[] = [];
    // 仮にファイル名を言語コードとする
    let lang = path.basename(uri.path, ".po");
    // 最初に空のエントリがある場合はスキップする
    let shouldSkipFirstEmptyEntry = true;
    let success = true;

    try {
      // 状態
      let state: "idle" | "inMsgId" | "inMsgStr" = "idle";
      let currentMsgIdParts: string[] = [];
      let currentMsgStrParts: string[] = [];
      // range tracking
      let currentMsgIdStartLine = 0,
        currentMsgIdStartCol = 0,
        currentMsgIdEndLine = 0,
        currentMsgIdEndCol = 0;
      let currentMsgStrStartLine = 0,
        currentMsgStrStartCol = 0,
        currentMsgStrEndLine = 0,
        currentMsgStrEndCol = 0;
      let hasMsgstr = false;

      const pushEntry = () => {
        const msgid = currentMsgIdParts.join("");
        const msgstr = currentMsgStrParts.join("");

        // header entry (最初の空のエントリ)
        if (!msgid) {
          // reset
          currentMsgIdParts = [];
          currentMsgStrParts = [];
          state = "idle";

          if (shouldSkipFirstEmptyEntry) {
            shouldSkipFirstEmptyEntry = false;
          }
          // ヘッダに Language: xx が含まれる場合は上書き
          const m = msgstr.match(/(^|\\n)Language:\s*([^\\n\\r]+)/i);
          if (m) {
            lang = m[2].trim();
          }
          return;
        }

        shouldSkipFirstEmptyEntry = false;

        // エラー: msgstr がない
        if (!hasMsgstr) {
          diagnostics.push(
            vscTypeHelper.newDiagnostic(
              vscTypeHelper.newRange(
                currentMsgIdStartLine,
                currentMsgIdStartCol,
                currentMsgIdEndLine,
                currentMsgIdEndCol,
              ),
              `missing msgstr for msgid '${msgid}'`,
              MyDiagnosticSeverity.Error,
            ),
          );
          success = false;
          // reset
          currentMsgIdParts = [];
          currentMsgStrParts = [];
          state = "idle";
          hasMsgstr = false;
          return;
        }

        // エラー: 空文字列
        if (msgstr.trim() === "") {
          diagnostics.push(
            vscTypeHelper.newDiagnostic(
              vscTypeHelper.newRange(
                currentMsgStrStartLine || currentMsgIdStartLine,
                currentMsgStrStartCol || currentMsgIdStartCol,
                currentMsgStrEndLine || currentMsgIdEndLine,
                currentMsgStrEndCol || currentMsgIdEndCol,
              ),
              `empty msgstr for msgid '${msgid}'`,
              MyDiagnosticSeverity.Warning,
            ),
          );
          success = false;
          // reset
          currentMsgIdParts = [];
          currentMsgStrParts = [];
          state = "idle";
          hasMsgstr = false;
          return;
        }

        // 重複チェック
        if (entries[msgid]) {
          diagnostics.push(
            vscTypeHelper.newDiagnostic(
              vscTypeHelper.newRange(
                currentMsgIdStartLine,
                currentMsgIdStartCol,
                currentMsgIdEndLine,
                currentMsgIdEndCol,
              ),
              `duplicate msgid '${msgid}'`,
              MyDiagnosticSeverity.Warning,
            ),
          );
        }

        // 登録
        entries[msgid] = {
          translation: msgstr,
          location: vscTypeHelper.newLocation(
            uri,
            vscTypeHelper.newRange(
              currentMsgIdStartLine,
              currentMsgIdStartCol,
              currentMsgIdEndLine,
              currentMsgIdEndCol,
            ),
          ),
        };

        // reset
        currentMsgIdParts = [];
        currentMsgStrParts = [];
        state = "idle";
        hasMsgstr = false;
      };

      for (let i = 0; i < text.length; i++) {
        const rawLine = text[i];
        const line = rawLine.trim();

        if (!line) {
          // エントリ区切り
          if (state !== "idle") {
            pushEntry();
          }
          continue;
        }

        // コメント行は無視
        if (line.startsWith("#")) {
          continue;
        }

        // msgid 行
        let m = line.match(/^msgid\s+(".*")\s*$/);
        if (m) {
          // 新しいエントリの開始
          if (state !== "idle") {
            // 以前のエントリを閉じる
            pushEntry();
          }
          state = "inMsgId";
          currentMsgIdParts = [];
          // track start/end columns on this line
          const firstQuote = rawLine.indexOf('"');
          const lastQuote = rawLine.lastIndexOf('"');
          currentMsgIdStartLine = i;
          currentMsgIdStartCol = Math.max(0, firstQuote);
          currentMsgIdEndLine = i;
          currentMsgIdEndCol = lastQuote >= 0 ? lastQuote + 1 : currentMsgIdStartCol;
          const s = parsePoQuotedString(m[1]);
          currentMsgIdParts.push(s);
          continue;
        }
        // msgid があるが引用符がないなどフォーマット不正
        if (line.startsWith("msgid")) {
          const col = rawLine.indexOf("msgid");
          const endCol = col >= 0 ? col + 5 : 0;
          diagnostics.push(
            vscTypeHelper.newDiagnostic(
              vscTypeHelper.newRange(i, col >= 0 ? col : 0, i, endCol),
              `invalid msgid format, expected quoted string`,
              MyDiagnosticSeverity.Error,
            ),
          );
          success = false;
          continue;
        }

        // msgstr 行
        m = line.match(/^msgstr\s+(".*")\s*$/);
        if (m) {
          state = "inMsgStr";
          currentMsgStrParts = [];
          hasMsgstr = true;
          // track start/end columns
          const firstQuote = rawLine.indexOf('"');
          const lastQuote = rawLine.lastIndexOf('"');
          currentMsgStrStartLine = i;
          currentMsgStrStartCol = Math.max(0, firstQuote);
          currentMsgStrEndLine = i;
          currentMsgStrEndCol = lastQuote >= 0 ? lastQuote + 1 : currentMsgStrStartCol;
          const s = parsePoQuotedString(m[1]);
          currentMsgStrParts.push(s);
          continue;
        }
        // msgstr があるが引用符がないなどフォーマット不正
        if (line.startsWith("msgstr")) {
          const col = rawLine.indexOf("msgstr");
          const endCol = col >= 0 ? col + 6 : 0;
          diagnostics.push(
            vscTypeHelper.newDiagnostic(
              vscTypeHelper.newRange(i, col >= 0 ? col : 0, i, endCol),
              `invalid msgstr format, expected quoted string`,
              MyDiagnosticSeverity.Error,
            ),
          );
          success = false;
          continue;
        }

        // 継続行: "..."
        m = line.match(/^(".*")\s*$/);
        if (m) {
          const s = parsePoQuotedString(m[1]);
          const firstQuote = rawLine.indexOf('"');
          const lastQuote = rawLine.lastIndexOf('"');
          if (state === "inMsgId") {
            currentMsgIdParts.push(s);
            // update end pos
            currentMsgIdEndLine = i;
            currentMsgIdEndCol = lastQuote >= 0 ? lastQuote + 1 : currentMsgIdEndCol;
          } else if (state === "inMsgStr") {
            currentMsgStrParts.push(s);
            currentMsgStrEndLine = i;
            currentMsgStrEndCol = lastQuote >= 0 ? lastQuote + 1 : currentMsgStrEndCol;
          } else {
            // 文法エラー: 継続行があるが msgid/msgstr の中でない
            const col = firstQuote >= 0 ? firstQuote : 0;
            const endCol = lastQuote >= 0 ? lastQuote + 1 : col + (m[1] ? m[1].length : 1);
            diagnostics.push(
              vscTypeHelper.newDiagnostic(
                vscTypeHelper.newRange(i, col, i, endCol),
                `unexpected continuation string outside of msgid/msgstr: ${m[1]}`,
                MyDiagnosticSeverity.Warning,
              ),
            );
            success = false;
          }
          continue;
        }

        // その他: 未対応の行は警告
        diagnostics.push(
          vscTypeHelper.newDiagnostic(
            vscTypeHelper.newRange(i, 0, i, 0),
            `unrecognized line in .po: ${line}`,
            MyDiagnosticSeverity.Warning,
          ),
        );
        success = false;
      }

      // 最終エントリをプッシュ
      if (state !== "idle") {
        pushEntry();
      }
    } catch (error) {
      diagnostics.push(
        vscTypeHelper.newDiagnostic(
          vscTypeHelper.newRange(0, 0, 0, 0),
          `unknown parse error`,
          MyDiagnosticSeverity.Warning,
        ),
      );
    }

    return {
      entries: { [lang]: entries },
      diagnostics,
      success,
    };
  }
}

function parsePoQuotedString(q: string): string {
  // q は先頭と末尾が " で囲まれていることを期待
  // 複数の"..." は parse の上で連結される
  // エスケープされた文字を処理する
  let inner = q;
  if (inner.startsWith('"') && inner.endsWith('"')) {
    inner = inner.substring(1, inner.length - 1);
  }
  // unescape: \n, \t, \" etc.
  inner = inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  return inner;
}
