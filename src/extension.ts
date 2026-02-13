// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { VSCodeWorkspaceService } from "./models/vscWorkspace";
import { L10nService } from "./services/l10nService";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "localize-support" is now active!',
  );

  // --- existing example command -------------------------------------------------
  const disposable = vscode.commands.registerCommand(
    "localize-support.helloWorld",
    () => {
      vscode.window.showInformationMessage(
        "Hello World from localize-support!",
      );
    },
  );
  context.subscriptions.push(disposable);

  // --- L10nService + Diagnostics integration -----------------------------------
  const workspaceService = new VSCodeWorkspaceService();
  const l10nService = new L10nService(workspaceService);
  context.subscriptions.push({
    dispose: () => l10nService.dispose().catch(() => undefined),
  });

  // Diagnostic collection for the extension
  const diagCollection =
    vscode.languages.createDiagnosticCollection("localize-support");
  context.subscriptions.push(diagCollection);

  // Convert internal MyDiagnostic to vscode.Diagnostic
  function toVscodeDiagnostics(
    diags: import("./models/vscTypes").MyDiagnostic[],
  ) {
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

  // Update vscode diagnostics from L10nService
  async function updateDiagnostics() {
    const { diags } = l10nService.getDiagnostics();
    // clear previous
    diagCollection.clear();
    for (const [uri, arr] of diags.entries()) {
      try {
        const vscUri = vscode.Uri.parse(uri);
        diagCollection.set(vscUri, toVscodeDiagnostics(arr));
      } catch (err) {
        console.error("Failed to set diagnostics for", uri, err);
      }
    }
  }

  // wire up reload events
  l10nService.onReloaded(() => {
    updateDiagnostics().catch((e) => console.error(e));
  });

  // initialize service and populate diagnostics
  l10nService
    .init()
    .then(() => updateDiagnostics())
    .catch((e) => console.error(e));
}

// This method is called when your extension is deactivated
export function deactivate() {}
