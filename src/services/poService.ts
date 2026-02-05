import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "../poManager";

export class POService {
  constructor(private poManager: POManager) {}

  public async ensureDirs(dirs: string[], workspaceFolder: vscode.WorkspaceFolder | null) {
    return this.poManager.ensureDirs(dirs, workspaceFolder);
  }

  public getTranslations(msgid: string, allowedDirs?: string[]) {
    return this.poManager.getTranslations(msgid, allowedDirs);
  }

  public getEntryStatus(msgid: string, allowedDirs?: string[]) {
    return this.poManager.getEntryStatus(msgid, allowedDirs);
  }

  public getAllMsgids(allowedDirs?: string[]) {
    return this.poManager.getAllMsgids(allowedDirs);
  }

  public getDefinitionLocations(msgid: string, allowedDirs?: string[]) {
    const entries = this.poManager.getEntryStatus(msgid, allowedDirs);
    const locations: vscode.Location[] = [];
    for (const e of entries) {
      if (e.hasEntry && typeof e.line === "number") {
        const pos = new vscode.Position(e.line, 0);
        locations.push(new vscode.Location(e.uri, pos));
      }
    }
    return locations;
  }
}
