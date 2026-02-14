import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";
import { MyPosition } from "../models/vscTypes";

/**
 * VS Code の「参照の検索 (Find References)」機能に対応するプロバイダ。
 * `L10nService` から参照情報を取得して VS Code の `Location[]` に変換して返す。
 */
export class ReferenceProvider implements vscode.ReferenceProvider {
  constructor(private l10nService: L10nService) {} 

  public provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
  ): vscode.ProviderResult<vscode.Location[]> {
    const uri = document.uri as any;
    const myPos: MyPosition = { line: position.line, character: position.character } as any;

    const locs = this.l10nService.findReferences(uri as any, myPos) || [];
    if (!locs || locs.length === 0) {
      return [];
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
