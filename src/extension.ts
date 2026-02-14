// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { VSCoderWrapper } from "./models/vscWorkspace";
import { L10nService } from "./services/l10nService";
import { DiagnosticProvider } from "./providers/diagnosticProvider";
import { DefinitionProvider } from "./providers/definitionProvider";
import { ReferenceProvider } from "./providers/referenceProvider";
import { CodeLanguages, CodeLanguageFileExtMap } from "./models/l10nTypes";
import { registerOpenLocationCommand } from "./commands/openLocationCommand";
import { HoverProvider } from "./providers/hoverProvider";
import { L10nRenameProvider } from "./providers/renameProvider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

  // --- L10nService -----------------------------------
  const vscodeWrapper = new VSCoderWrapper();
  const logger = vscodeWrapper.window.logger;
  const l10nService = new L10nService(vscodeWrapper.workspace, logger);
  context.subscriptions.push(l10nService);
  await l10nService.init().catch((e) => logger.error(e));

  const filePatterns = CodeLanguages.map((l) => CodeLanguageFileExtMap.get(l))
    .filter((e): e is string => !!e)
    .map((ext) => ({ scheme: "file", pattern: `**/*.${ext}` }));

    const docSelectors: vscode.DocumentSelector = [
    // prefer language identifiers when available
    ...CodeLanguages.map((l): vscode.DocumentFilter => ({ language: l })),
    // also match common file extensions so features work in test environments
    ...filePatterns,
    { scheme: "file", pattern: "**/*.po" },
  ];

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(docSelectors, new DefinitionProvider(l10nService)));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(docSelectors, new ReferenceProvider(l10nService)));
  context.subscriptions.push(vscode.languages.registerRenameProvider(docSelectors, new L10nRenameProvider(l10nService)));

  context.subscriptions.push(registerOpenLocationCommand(vscodeWrapper.command, vscodeWrapper.window.logger, vscodeWrapper.window));
  context.subscriptions.push(vscode.languages.registerHoverProvider(docSelectors, new HoverProvider(l10nService)));

  logger.info("localize-support activated");
}

// This method is called when your extension is deactivated
export function deactivate() {}
