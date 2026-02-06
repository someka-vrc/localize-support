import * as vscode from "vscode";
import * as path from "path";

export async function collectConfigsForDocument(documentUri: vscode.Uri) {
  const ws = (vscode.workspace && typeof (vscode.workspace as any).getWorkspaceFolder === 'function') ? vscode.workspace.getWorkspaceFolder(documentUri) : undefined;
  if (!ws) {
    return {
      sourceDirs: [] as string[],
      poDirs: [] as string[],
      localizeFuncs: [] as string[],
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
        const processCfg = (cfg: any) => {
          if (Array.isArray(cfg.sourceDirs)) {
            for (const s of cfg.sourceDirs) {
              const resolved = path.resolve(dir, s);
              sourceSet.add(resolved);
            }
          }
          if (Array.isArray(cfg.poDirs)) {
            for (const p of cfg.poDirs) {
              const resolved = path.resolve(dir, p);
              poSet.add(resolved);
            }
          }
          if (Array.isArray(cfg.localizeFuncs)) {
            for (const f of cfg.localizeFuncs) {
              if (typeof f === "string") {
                localizeSet.add(f);
              }
            }
          }
        };
        if (Array.isArray(parsed.config)) {
          for (const cfg of parsed.config) {
            processCfg(cfg);
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

export async function collectConfigObjectsForDocument(documentUri: vscode.Uri) {
  const ws = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!ws) {
    return [] as {
      sourceDirs: string[];
      poDirs: string[];
      localizeFuncs: string[];
      workspaceFolder: vscode.WorkspaceFolder | null;
    }[];
  }
  const configs: {
    sourceDirs: string[];
    poDirs: string[];
    localizeFuncs: string[];
    workspaceFolder: vscode.WorkspaceFolder | null;
  }[] = [];
  let dir = path.dirname(documentUri.fsPath);
  const wsRoot = ws.uri.fsPath;
  while (true) {
    for (const name of ["podotnetconfig.json", "podotnetconfig~.json"]) {
      const cfgUri = vscode.Uri.file(path.join(dir, name));
      try {
        const bytes = await vscode.workspace.fs.readFile(cfgUri);
        const content = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(content);
        const processCfg = (cfg: any) => {
          const sourceDirs: string[] = [];
          const poDirs: string[] = [];
          const localizeFuncs: string[] = [];
          if (Array.isArray(cfg.sourceDirs)) {
            for (const s of cfg.sourceDirs) {
              sourceDirs.push(path.resolve(dir, s));
            }
          }
          if (Array.isArray(cfg.poDirs)) {
            for (const p of cfg.poDirs) {
              poDirs.push(path.resolve(dir, p));
            }
          }
          if (Array.isArray(cfg.localizeFuncs)) {
            for (const f of cfg.localizeFuncs) {
              if (typeof f === "string") {
                localizeFuncs.push(f);
              }
            }
          }
          configs.push({ sourceDirs, poDirs, localizeFuncs, workspaceFolder: ws });
        };
        if (Array.isArray(parsed.config)) {
          for (const cfg of parsed.config) {
            processCfg(cfg);
          }
        } else {
          processCfg(parsed);
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

  // Also read settings from configuration (per-folder settings if present)
  try {
    const conf = vscode.workspace.getConfiguration("poDotnet", documentUri);
    const s = conf.get<any>("config");
    const addCfg = (cfg: any) => {
      const sourceDirs: string[] = [];
      const poDirs: string[] = [];
      const localizeFuncs: string[] = [];
      if (Array.isArray(cfg.sourceDirs)) {
        for (const sd of cfg.sourceDirs) {
          // resolve relative to workspace root
          sourceDirs.push(path.resolve(ws.uri.fsPath, sd));
        }
      }
      if (Array.isArray(cfg.poDirs)) {
        for (const pd of cfg.poDirs) {
          poDirs.push(path.resolve(ws.uri.fsPath, pd));
        }
      }
      if (Array.isArray(cfg.localizeFuncs)) {
        for (const f of cfg.localizeFuncs) {
          if (typeof f === "string") {
            localizeFuncs.push(f);
          }
        }
      }
      configs.push({ sourceDirs, poDirs, localizeFuncs, workspaceFolder: ws });
    };
    if (Array.isArray(s)) {
      for (const cfg of s) {
        addCfg(cfg);
      }
    }
  } catch (e) {
    // ignore config read errors
  }

  return configs;
}

export async function collectAllConfigsInWorkspace() {
  const cfgUris = await vscode.workspace.findFiles("**/podotnetconfig.json");
  const cfgUrisTilde = await vscode.workspace.findFiles("**/podotnetconfig~.json");
  const allCfgs = cfgUris.concat(cfgUrisTilde);
  const cfgsByWorkspace = new Map<string, { sourceDirs: string[]; poDirs: string[]; localizeFuncs: string[]; workspaceFolder: vscode.WorkspaceFolder }[]>();
  for (const cfgUri of allCfgs) {
    const dir = path.dirname(cfgUri.fsPath);
    try {
      const bytes = await vscode.workspace.fs.readFile(cfgUri);
      const content = new TextDecoder("utf-8").decode(bytes);
      const parsed = JSON.parse(content);
      const sourceDirs: string[] = [];
      const poDirs: string[] = [];
      const localizeFuncs: string[] = [];
      const processCfg = (cfg: any) => {
        if (Array.isArray(cfg.sourceDirs)) {
          for (const s of cfg.sourceDirs) {
            sourceDirs.push(path.resolve(dir, s));
          }
        }
        if (Array.isArray(cfg.poDirs)) {
          for (const p of cfg.poDirs) {
            poDirs.push(path.resolve(dir, p));
          }
        }
        if (Array.isArray(cfg.localizeFuncs)) {
          for (const f of cfg.localizeFuncs) {
            if (typeof f === "string") {
              localizeFuncs.push(f);
            }
          }
        }
      };
      if (Array.isArray(parsed.config)) {
        for (const cfg of parsed.config) {
          processCfg(cfg);
        }
      } else {
        processCfg(parsed);
      }
      const ws = vscode.workspace.getWorkspaceFolder(cfgUri);
      if (!ws) {
        continue;
      }
      if (!cfgsByWorkspace.has(ws.uri.toString())) {
        cfgsByWorkspace.set(ws.uri.toString(), []);
      }
      cfgsByWorkspace.get(ws.uri.toString())!.push({ sourceDirs, poDirs, localizeFuncs, workspaceFolder: ws });
    } catch (e) {
      // ignore
    }
  }
  return cfgsByWorkspace;
}
