import * as vscode from "vscode";
import { Disposable, MyDiagnostic, IVSCodeWrapper } from "../models/vscTypes";
import { L10nService } from "../services/l10nService";

export class DiagnosticProvider implements Disposable {
  private collection: vscode.DiagnosticCollection;
  private disposables: Disposable[] = [];

  constructor(
    public name: string,
    private l10nService: L10nService,
    private vscode: IVSCodeWrapper,
  ) {
    this.collection = this.vscode.languages.createDiagnosticCollection(name);
    this.disposables.push(
      l10nService.onReloaded(() => {
        this.updateDiagnostics(l10nService.getDiagnostics().diags).catch((e) => this.vscode.window.logger.error(e));
      }),
    );

    this.updateDiagnostics(l10nService.getDiagnostics().diags).catch((e) => this.vscode.window.logger.error(e));
  }

  dispose() {
    this.collection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  // Update vscode diagnostics from L10nService
  async updateDiagnostics(diags: Map<string, MyDiagnostic[]>) {
    // clear previous
    this.collection.clear();
    for (const [uri, arr] of diags.entries()) {
      try {
        const vscUri = vscode.Uri.parse(uri);
        this.collection.set(vscUri, this.toVscodeDiagnostics(arr));
      } catch (err) {
        this.vscode.window.logger.error("Failed to set diagnostics for", uri, err);
      }
    }
  }

  // Convert internal MyDiagnostic to vscode.Diagnostic
  toVscodeDiagnostics(diags: MyDiagnostic[]) {
    return diags.map((d) => {
      const range = new vscode.Range(
        d.range.start.line,
        d.range.start.character,
        d.range.end.line,
        d.range.end.character,
      );
      const severity = d.severity as unknown as vscode.DiagnosticSeverity;
      return new vscode.Diagnostic(range, d.message, severity);
    });
  }
}
