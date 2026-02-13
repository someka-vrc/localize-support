// export interface IDisposable {
//     dispose(): Promise<void>;
// }

import { MyDiagnostic } from "./vscTypes";
import { URI } from "vscode-uri";

export type DiagOrStatus =
  | {
      type: "diagnostic";
      diagnostics: { uri: URI; diagnostics: MyDiagnostic[] };
    }
  | {
      type: "status";
      messages: string[];
    };