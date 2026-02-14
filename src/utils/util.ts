// import { Disposable, FileType, RelativePattern, Uri, workspace } from "vscode";
import { IWorkspaceWrapper, FileType } from "../models/vscTypes";
import { URI, Utils } from "vscode-uri";
/**
 * ディレクトリパスを正規化する
 * @param file ファイルの Uri または workspace folder index
 * @param relativeFromSettingDir file のフォルダからの相対パス
 * @returns 正規化されたディレクトリの Uri、存在しない場合は undefined
 */
export async function normalizeDirPath(
  workspace: IWorkspaceWrapper,
  file: URI | number,
  relativeFromSettingDir: any = "",
): Promise<URI | undefined> {
  if (typeof relativeFromSettingDir !== "string") {
    return undefined;
  }

  let settingDir: URI | undefined = undefined;
  // concrete localize-support.json file
  if (typeof file !== "number") {
    settingDir = Utils.dirname(file);
  } else {
    // settings.json in user / workspace settings
    const wsfs = workspace.getWorkspaceFolders();
    if (wsfs && file < wsfs.length) {
      settingDir = wsfs[file].uri;
    }
  }
  if (!settingDir) {
    return undefined;
  }
  const resolved = relativeFromSettingDir ? Utils.joinPath(settingDir, relativeFromSettingDir) : settingDir;
  return (await workspace.fs.validateDirectoryPath(resolved)) ? resolved : undefined;
}
