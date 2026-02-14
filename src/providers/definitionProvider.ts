import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";
import { MyPosition } from "../models/vscTypes";

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
    const uri = document.uri as any;
    const myPos: MyPosition = { line: position.line, character: position.character } as any;

    const locs = this.l10nService.findDefinition(uri as any, myPos) || [];
    if (!locs || locs.length === 0) {
      return null;
    }

    return locs.map((loc) => {
      const uriStr = (loc.uri as any).toString();
      const vscUri = vscode.Uri.parse(uriStr);
      const range = new vscode.Range(
        loc.range.start.line,
        loc.range.start.character,
        loc.range.end.line,
        loc.range.end.character,
      );
      return new vscode.Location(vscUri, range);
    });
  }
}
