import * as vscode from "vscode";
import { MyPosition } from "../models/vscodeTypes";
import { toURI, toVscLocation } from "../models/vscodeTypeConverter";
import { L10nService } from "../services/l10nService";

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
    const uri = toURI(document.uri);
    const myPos: MyPosition = { line: position.line, character: position.character } as any;

    const locs = this.l10nService.findReferences(uri, myPos) || [];
    if (!locs || locs.length === 0) {
      return [];
    }

    return locs.map((loc) => {
      return toVscLocation(loc);
    });
  }
}
