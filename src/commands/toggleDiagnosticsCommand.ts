import { ICommandWrapper, LogOutputChannel } from "../models/vscodeTypes";
import { DiagnosticProvider } from "../providers/diagnosticProvider";
import * as vscode from "vscode";

const stateKey = "localize-support.diagnosticsEnabled";

export function registerToggleDiagnosticsCommand(
  command: ICommandWrapper,
  logger: LogOutputChannel,
  diagnosticProvider?: DiagnosticProvider,
  workspaceState?: { get(key: string, defaultValue?: any): any; update(key: string, value: any): Thenable<void> },
) {
  return command.registerCommand("localize-support.toggleDiagnostics", async () => {
    try {
      await registerToggleDiagnosticsHandler(diagnosticProvider, workspaceState);
    } catch (err) {
      logger.error("localize-support.toggleDiagnostics failed", err as Error);
    }
  });
}

export async function registerToggleDiagnosticsHandler(
  diagnosticProvider?: DiagnosticProvider,
  workspaceState?: { get(key: string, defaultValue?: any): any; update(key: string, value: any): Thenable<void> },
) {
  if (!diagnosticProvider || !workspaceState) {
    return;
  }
  const enabled = workspaceState.get(stateKey, true) as boolean;
  const newVal = !enabled;
  await workspaceState.update(stateKey, newVal);
  await diagnosticProvider.setEnabled(newVal);
  await vscode.window.showInformationMessage(newVal ? "Diagnostics are now ON" : "Diagnostics are now OFF");
}
