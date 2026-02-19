import { ICommandWrapper, MyRange, LogOutputChannel } from "../models/vscodeTypes";
import { toVscRange, toVscUri } from "../models/vscodeTypeConverter";
import * as vscode from "vscode";
import { URI } from "vscode-uri";

export function registerOpenLocationCommand(command: ICommandWrapper, logger: LogOutputChannel) {
  return command.registerCommand("localize-support.openLocation", async (arg: any) => {
    try {
      if (window) {
        await openLocationHandler(arg);
      }
    } catch (err) {
      logger.error("localize-support.openLocation failed", err as Error);
    }
  });
}

/**
 * コマンドの本体
 */
export async function openLocationHandler(arg: any): Promise<void> {
  const payload = Array.isArray(arg) ? arg[0] : arg;
  const uriStr = typeof payload.uri === "string" ? payload.uri : payload.uri && payload.uri.toString();
  if (!uriStr) {
    return;
  }
  const uri = URI.parse(uriStr);
  const loc = payload.location || payload.range;
  const vscOptions: vscode.TextDocumentShowOptions = {};
  if (loc && loc.range) {
    vscOptions.selection = toVscRange(loc.range);
  }
  return vscode.window.showTextDocument(toVscUri(uri), vscOptions).then(() => {});
}
