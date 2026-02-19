import * as vscode from "vscode";
import { MyPosition } from "../models/vscodeTypes";
import { toURI, toVscLocation } from "../models/vscodeTypeConverter";
import { L10nService } from "../services/l10nService";

/**
 * ローカライズキーの定義（Go to Definition / Peek definition）を提供するプロバイダ。
 * `L10nService` から定義位置を取得して VS Code に返す。
 */
export class DefinitionProvider implements vscode.DefinitionProvider {
  constructor(private l10nService: L10nService) {} 
  
  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Location[]> {
    const uri = toURI(document.uri);
    const myPos: MyPosition = { line: position.line, character: position.character } as any;

    const locs = this.l10nService.findDefinition(uri, myPos) || [];
    if (!locs || locs.length === 0) {
      return null;
    }

    return locs.map((loc) => {
      return toVscLocation(loc);
    });
  }
}
