// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import { POManager } from "./services/poManager";
import { LocalizationChecker as ImportedLocalizationChecker } from "./services/localizationChecker";
import { POService } from "./services/poService";
import { LocalizationService } from "./services/localizationService";
import { registerHoverProvider } from "./providers/hoverProvider";
import { registerCompletionProvider } from "./providers/completionProvider";
import { registerDefinitionProvider } from "./providers/definitionProvider";
import { registerReferenceProvider } from "./providers/referenceProvider";
import { registerRenameProvider } from "./providers/renameProvider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  // command: create podotnetconfig.json next to active file
  // register after localizationChecker is created so we can trigger a rescan
  // (command is pushed into context.subscriptions further below)


  const poManager = new POManager(context);
  context.subscriptions.push({
    dispose: () => poManager.dispose(),
  } as vscode.Disposable);

  const localizationChecker = new ImportedLocalizationChecker(context, poManager);
  context.subscriptions.push(localizationChecker);

  const poService = new POService(poManager);
  const localizationService = new LocalizationService(localizationChecker);

  const hoverProvider = registerHoverProvider(context, localizationService, poService);
  const completionProvider = registerCompletionProvider(context, localizationService, poService);
  const definitionProvider = registerDefinitionProvider(context, localizationService, poService);
  const referenceProvider = registerReferenceProvider(context, localizationService, poService);
  const renameProvider = registerRenameProvider(context, localizationService, poService);

  const createConfigCmd = vscode.commands.registerCommand(
    "po-dotnet.createConfig",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(
          "No active editor. Open a file to create podotnetconfig.json in its folder.",
        );
        return;
      }
      const docUri = editor.document.uri;
      const dir = path.dirname(docUri.fsPath);
      const cfgUri = vscode.Uri.file(path.join(dir, "podotnetconfig.json"));
      try {
        // check existing
        try {
          await vscode.workspace.fs.stat(cfgUri);
          // file exists — do not overwrite
          vscode.window.showErrorMessage("podotnetconfig.json already exists in this folder.");
          return;
        } catch (e) {
          // file does not exist -> continue
        }

        const defaultCfg = {
          sourceDirs: ["."],
          poDirs: ["./L10N"],
          localizeFuncs: ["G"],
        };
        const content = JSON.stringify(defaultCfg, null, 2) + "\n";
        await vscode.workspace.fs.writeFile(
          cfgUri,
          new TextEncoder().encode(content),
        );
        vscode.window.showInformationMessage(
          "Created podotnetconfig.json",
        );
        try {
          await localizationChecker.triggerScan();
        } catch (_) {}
      } catch (e) {
        vscode.window.showErrorMessage(
          "Failed to create podotnetconfig.json: " + String(e),
        );
      }
    },
  );

  const openPoCmd = vscode.commands.registerCommand(
    "po-dotnet.openPoEntry",
    async (uriStr: string | vscode.Uri, line?: number) => {
      try {
        const uri = typeof uriStr === "string" ? vscode.Uri.parse(uriStr) : uriStr;
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(line || 0, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } catch (e) {
        vscode.window.showErrorMessage("Failed to open PO file: " + String(e));
      }
    },
  );

  const reloadCmd = vscode.commands.registerCommand(
    "po-dotnet.reloadData",
    async () => {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Reloading PO .NET data...", cancellable: false }, async () => {
          await localizationChecker.reload();
          vscode.window.showInformationMessage("Reloaded PO data (cache cleared)");
        });
      } catch (e) {
        vscode.window.showErrorMessage("Failed to reload PO data: " + String(e));
      }
    },
  );

  const waitIdleCmd = vscode.commands.registerCommand("po-dotnet.waitForScanIdle", async (timeoutMs?: number) => {
    try {
      await localizationChecker.waitUntilIdle(timeoutMs || 5000);
      return true;
    } catch (_) {
      return false;
    }
  });

  // Test-only helper to invoke the rename provider logic directly (bypass RPC arg validation)
  const invokeRenameTestCmd = vscode.commands.registerCommand('po-dotnet.test.invokeRenameProvider', async (uriLike: string | vscode.Uri, posLike: { line: number; character: number } | vscode.Position, newName: string) => {
    try {
      // renameProvider exposes invokeRenameForTest via the object returned from registerRenameProvider
      // it will apply the edits directly and return { success: true } or { success: false, error }
      const res: any = await (renameProvider as any).invokeRenameForTest(uriLike, posLike, newName);
      return res;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  context.subscriptions.push(createConfigCmd, openPoCmd, reloadCmd, hoverProvider, completionProvider, definitionProvider, referenceProvider, renameProvider, invokeRenameTestCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {}
