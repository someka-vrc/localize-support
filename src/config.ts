import * as vscode from "vscode";
import * as path from "path";

export async function collectConfigsForDocument(documentUri: vscode.Uri) {
  const ws = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!ws) {
    return {
      sourceDirs: [] as string[],
      poDirs: [] as string[],
      workspaceFolder: null,
    };
  }
  const sourceSet = new Set<string>();
  const poSet = new Set<string>();
  const localizeSet = new Set<string>();
  let dir = path.dirname(documentUri.fsPath);
  const wsRoot = ws.uri.fsPath;
  while (true) {
    for (const name of ["podotnetconfig.json", "podotnetconfig~.json"]) {
      const cfgUri = vscode.Uri.file(path.join(dir, name));
      try {
        const bytes = await vscode.workspace.fs.readFile(cfgUri);
        const content = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.sourceDirs)) {
          for (const s of parsed.sourceDirs) {
            const resolved = path.resolve(dir, s);
            sourceSet.add(resolved);
          }
        }
        if (Array.isArray(parsed.poDirs)) {
          for (const p of parsed.poDirs) {
            const resolved = path.resolve(dir, p);
            poSet.add(resolved);
          }
        }
        if (Array.isArray(parsed.localizeFuncs)) {
          for (const f of parsed.localizeFuncs) {
            if (typeof f === "string") {
              localizeSet.add(f);
            }
          }
        }
      } catch (e) {
        // no config here or parse error -- ignore
      }
    }
    if (dir === wsRoot) {
      break;
    }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) {
      break;
    }
    dir = parent;
  }
  return {
    sourceDirs: Array.from(sourceSet),
    poDirs: Array.from(poSet),
    localizeFuncs: Array.from(localizeSet),
    workspaceFolder: ws,
  };
}
