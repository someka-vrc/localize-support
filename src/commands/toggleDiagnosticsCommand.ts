import { ICommandWrapper, IWindowWrapper, LogOutputChannel } from "../models/vscodeTypes";
import { DiagnosticProvider } from "../providers/diagnosticProvider";

const stateKey = "localize-support.diagnosticsEnabled";

export function registerToggleDiagnosticsCommand(
  command: ICommandWrapper,
  logger: LogOutputChannel,
  window?: IWindowWrapper,
  diagnosticProvider?: DiagnosticProvider,
  workspaceState?: { get(key: string, defaultValue?: any): any; update(key: string, value: any): Thenable<void> },
) {
  return command.registerCommand("localize-support.toggleDiagnostics", async () => {
    try {
      if (!window || !diagnosticProvider || !workspaceState) {
        return;
      }
      const enabled = workspaceState.get(stateKey, true) as boolean;
      const newVal = !enabled;
      await workspaceState.update(stateKey, newVal);
      await diagnosticProvider.setEnabled(newVal);
      await window.showInformationMessage(newVal ? "Diagnostics are now ON" : "Diagnostics are now OFF");
    } catch (err) {
      logger.error("localize-support.toggleDiagnostics failed", err as Error);
    }
  });
}
