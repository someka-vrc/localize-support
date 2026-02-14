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
  await l10nService.init().catch((e) => workspaceService.logger.error(e));

  const diagnosticsProvider = new DiagnosticProvider("localize-support", l10nService, workspaceService);
  context.subscriptions.push(diagnosticsProvider);

  // --- Definition & Reference providers (Go to / Peek / Find References) -----
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

  const defProvider = new DefinitionProvider(l10nService);
  const refProvider = new ReferenceProvider(l10nService);

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(docSelectors, defProvider));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(docSelectors, refProvider));

  // コマンド: Hover のファイルリンクから指定位置で開く
  context.subscriptions.push(
    vscode.commands.registerCommand("localize-support.openLocation", async (arg: any) => {
      try {
        const payload = Array.isArray(arg) ? arg[0] : arg;
        const uri = typeof payload.uri === "string" ? vscode.Uri.parse(payload.uri) : payload.uri;
        const loc = payload.location || payload.range;
        const options: vscode.TextDocumentShowOptions = {};
        if (loc && loc.range) {
          const r = loc.range;
          options.selection = new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
        }
        await vscode.window.showTextDocument(uri, options);
      } catch (err) {
        console.error("localize-support.openLocation failed", err);
      }
    }),
  );

  // --- Hover provider -------------------------------------------------
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(docSelectors, {
      provideHover(document: vscode.TextDocument, position: vscode.Position) {
        const myPos = { line: position.line, character: position.character } as any;
        const key = l10nService.getKeyAtPosition(document.uri as any, myPos);
        if (!key) {
          return null;
        }

        const items = l10nService.getTranslationsForKey(key) || [];
        if (!items || items.length === 0) {
          return null;
        }

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown("localize-support:\n");
        for (const it of items) {
          md.appendMarkdown("- ");
          md.appendText(it.translation || "");
          const payload = { uri: (it.uri as any).toString(), location: it.location };
          const arg = encodeURIComponent(JSON.stringify([payload]));
          md.appendMarkdown(` [${it.fileName}](command:localize-support.openLocation?${arg})\n`);
        }
        return new vscode.Hover(md);
      },
    }),
  );

  workspaceService.logger.info("localize-support activated");
}

// This method is called when your extension is deactivated
export function deactivate() {}
