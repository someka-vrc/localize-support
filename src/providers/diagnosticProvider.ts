import * as vscode from "vscode";
import { Disposable, MyDiagnostic, IVSCodeWrapper } from "../models/vscodeTypes";
import { toVscDiagnostics } from "../models/vscodeTypeConverter";
import { L10nService } from "../services/l10nService";

/**
 * `L10nService` の診断情報を受け取り、VS Code の `DiagnosticCollection` に同期するプロバイダ。
 * 拡張の起動時と L10nService の再読み込み時にコレクションを更新する。
 */
export class DiagnosticProvider implements Disposable {
  private collection: vscode.DiagnosticCollection;
  private disposables: Disposable[] = [];
  private enabled = true;

  constructor(
    public name: string,
    private l10nService: L10nService,
    private vscode: IVSCodeWrapper,
  ) {
    this.collection = this.vscode.languages.createDiagnosticCollection(name);
    this.disposables.push(
      l10nService.onReloaded(() => {
        this.updateDiagnostics(l10nService.getDiagnostics().diags).catch((e) => this.vscode.logger.error(e));
      }),
    );

    this.updateDiagnostics(l10nService.getDiagnostics().diags).catch((e) => this.vscode.logger.error(e));
  }

  dispose() {
    this.collection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  // Enable/disable diagnostics. When disabled, clear collection and stop updates.
  public async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.enabled) {
      this.collection.clear();
      return;
    }
    // when enabling, immediately refresh from service
    try {
      await this.updateDiagnostics(this.l10nService.getDiagnostics().diags);
    } catch (err) {
      this.vscode.logger.error(err as Error);
    }
  }

  public toggleEnabled() {
    this.setEnabled(!this.enabled).catch((e) => this.vscode.logger.error(e));
  }

  public isEnabled() {
    return this.enabled;
  }

  // Update vscode diagnostics from L10nService
  async updateDiagnostics(diags: Map<string, MyDiagnostic[]>) {
    if (!this.enabled) {
      return;
    }
    // clear previous
    this.collection.clear();
    for (const [uri, arr] of diags.entries()) {
      try {
        const vscUri = vscode.Uri.parse(uri);
        this.collection.set(vscUri, toVscDiagnostics(arr));
      } catch (err) {
        this.vscode.logger.error("Failed to set diagnostics for", uri, err);
      }
    }
  }

}
