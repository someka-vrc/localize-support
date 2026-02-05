import * as vscode from "vscode";
import { LocalizationChecker } from "../localizationChecker";
import { collectConfigObjectsForDocument } from "../config";
import * as path from "path";

export class LocalizationService {
  constructor(private checker: LocalizationChecker) {}

  public getMsgidAtPosition(document: vscode.TextDocument, position: vscode.Position) {
    const offset = document.offsetAt(position);
    return this.checker.getMsgidAt(document, offset);
  }

  public isScanned(document: vscode.TextDocument) {
    return this.checker.isScanned(document);
  }

  public async getAllowedPoDirsForDocument(document: vscode.TextDocument) {
    const cfgObjs = await collectConfigObjectsForDocument(document.uri);
    if (cfgObjs.length === 0) {
      return [] as { poDirs: string[]; workspaceFolder: vscode.WorkspaceFolder | null }[];
    }
    const docPath = document.uri.fsPath;
    const matched = cfgObjs.filter((c) =>
      c.sourceDirs.some((sd) => docPath === sd || docPath.startsWith(sd + path.sep)),
    );
    return matched.map((m) => ({ poDirs: m.poDirs, workspaceFolder: m.workspaceFolder }));
  }

  public getReferences(msgid: string, allowedSourceDirs?: string[]) {
    return this.checker.getReferences(msgid, allowedSourceDirs);
  }

  public async triggerScan() {
    return await this.checker.triggerScan();
  }

  public async scanDirs(dirs: string[]) {
    return await this.checker.scanDirs(dirs);
  }
}
