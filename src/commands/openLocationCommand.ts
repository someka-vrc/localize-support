import { IWindowWrapper, ICommandWrapper, MyRange, LogOutputChannel } from "../models/vscTypes";
import { URI } from "vscode-uri";

/**
 * コマンドの本体（単体テスト可能）
 */
export async function openLocationHandler(window: IWindowWrapper, arg: any): Promise<void> {
  const payload = Array.isArray(arg) ? arg[0] : arg;
  const uriStr = typeof payload.uri === "string" ? payload.uri : (payload.uri && payload.uri.toString());
  if (!uriStr) {
    return;
  }
  const uri = URI.parse(uriStr);
  const loc = payload.location || payload.range;
  const options: { selection?: MyRange } = {};
  if (loc && loc.range) {
    options.selection = loc.range;
  }
  await window.showTextDocument(uri as any, options);
}

/**
 * extension.ts から呼ぶための登録ヘルパー
 */
export function registerOpenLocationCommand(command: ICommandWrapper, logger: LogOutputChannel, window?: IWindowWrapper) {
  return command.registerCommand("localize-support.openLocation", async (arg: any) => {
    try {
      if (window) {
        await openLocationHandler(window, arg);
      }
    } catch (err) {
      logger.error("localize-support.openLocation failed", err as Error);
    }
  });
}


