// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { VSCodeWorkspaceService } from "./models/vscWorkspace";
import { L10nService } from "./services/l10nService";
import { DiagnosticProvider } from "./providers/diagnosticProvider";
import { DefinitionProvider } from "./providers/definitionProvider";
import { ReferenceProvider } from "./providers/referenceProvider";
import { CodeLanguages, CodeLanguageFileExtMap } from "./models/l10nTypes";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "localize-support" is now active!');

  // --- existing example command -------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("localize-support.helloWorld", () => {
      vscode.window.showInformationMessage("Hello World from localize-support!");
    }),
  );

  // --- L10nService -----------------------------------
  const workspaceService = new VSCodeWorkspaceService();
  const l10nService = new L10nService(workspaceService);
  context.subscriptions.push(l10nService);
  await l10nService.init().catch((e) => console.error(e));

  const diagnosticsProvider = new DiagnosticProvider("localize-support", l10nService);
  context.subscriptions.push(diagnosticsProvider);

  // --- Definition & Reference providers (Go to / Peek / Find References) -----
  const filePatterns = CodeLanguages
    .map((l) => CodeLanguageFileExtMap.get(l))
    .filter((e): e is string => !!e)
    .map((ext) => ({ scheme: "file", pattern: `**/*.${ext}` }));

  const docSelectors: vscode.DocumentSelector = [
    // prefer language identifiers when available
    ...CodeLanguages.map((l): vscode.DocumentFilter => ({ language: l })),
    // also match common file extensions so features work in test environments
    ...filePatterns,
    { scheme: "file", pattern: "**/*.po" },
  ];

  const defProvider = new DefinitionProvider(l10nService);
  const refProvider = new ReferenceProvider(l10nService);

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(docSelectors, defProvider));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(docSelectors, refProvider));
}

// This method is called when your extension is deactivated
export function deactivate() {}
