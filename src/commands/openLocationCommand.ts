import { IWorkspaceService, MyRange } from "../models/vscTypes";
import { URI } from "vscode-uri";

/**
 * コマンドの本体（単体テスト可能）
 */
export async function openLocationHandler(workspace: IWorkspaceService, arg: any): Promise<void> {
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
  await workspace.showTextDocument(uri as any, options);
}

/**
 * extension.ts から呼ぶための登録ヘルパー
 */
export function registerOpenLocationCommand(workspace: IWorkspaceService) {
  return workspace.registerCommand("localize-support.openLocation", async (arg: any) => {
    try {
      await openLocationHandler(workspace, arg);
    } catch (err) {
      console.error("localize-support.openLocation failed", err);
    }
  });
}


