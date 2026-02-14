import { EventEmitter } from "events";
import { URI } from "vscode-uri";
import { IWorkspaceWrapper, LogOutputChannel, MyRelativePattern, Disposable, FileType } from "../models/vscTypes";
import { L10nTarget, L10nCode, CodeLanguage, CodeLanguageFileExtMap } from "../models/l10nTypes";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";
import { CodeParser } from "./codeParser";
import { WasmDownloader } from "./wasmDownloader";
import * as path from "path";

type RebuildQueueItem = {
  thisArg: CodeManager;
  uri: URI;
  reason: "created" | "changed" | "deleted";
  text?: string;
};
// file-extension mapping moved to `CodeLanguageFileExtMap` in `src/models/l10nTypes.ts`
export class CodeManager implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly rebuiltEmitter = new EventEmitter();
  private readonly rebuildIntervalQueue: IntervalQueue<RebuildQueueItem>;

  // map: source file path (string) -> array of L10nCode (key + range)
  public readonly codes: Map<string, L10nCode[]> = new Map();

  // wasm downloader used by CodeParser instances
  private readonly wasmDownloader: WasmDownloader;

  constructor(
    private workspace: IWorkspaceWrapper,
    private logger: LogOutputChannel,
    private target: L10nTarget,
    rebuildIntervalMs: number = 500,
  ) {
    this.rebuildIntervalQueue = new IntervalQueue<RebuildQueueItem>(
      rebuildIntervalMs,
      async (item: RebuildQueueItem) => await item.thisArg.rebuildCache(item.uri, item.reason, item.text),
      this.logger,
      OrganizeStrategies.skipDuplicatesByKey<RebuildQueueItem>((item) => item.uri.path + "-" + item.reason),
    );

    // default wasm storage under project .tmp/wasms — tests may stub parsing instead of downloading
    this.wasmDownloader = new WasmDownloader(this.workspace, this.logger, URI.file(path.join(process.cwd(), ".tmp/wasms")));
    this.disposables.push(this.wasmDownloader);
  }

  public onRebuilt(listener: () => any): Disposable {
    this.rebuiltEmitter.on("rebuilt", listener);
    return {
      dispose: () => {
        try {
          (this.rebuiltEmitter as any).off?.("rebuilt", listener);
          this.rebuiltEmitter.removeListener("rebuilt", listener as any);
        } catch (err) {
          this.logger.warn("CodeManager.onRebuilt.dispose failed", err);
        }
      },
    };
  }

  public async init() {
    if (
      this.target.codeLanguages.length === 0 ||
      this.target.codeDirs.length === 0 ||
      this.target.l10nFuncNames.length === 0
    ) {
      return; // nothing to do
    }

    // watch each configured codeDir and perform initial scan
    for (const baseUri of this.target.codeDirs) {
      const pattern = this.buildGlobForLanguages(this.target.codeLanguages);
      const rel: MyRelativePattern = { baseUri, pattern } as MyRelativePattern;

      const fsWatcher = this.workspace.createFileSystemWatcher(rel);
      fsWatcher.onDidCreate((uri) => this.handleFileEvent(uri, "created"));
      fsWatcher.onDidChange((uri) => this.handleFileEvent(uri, "changed"));
      fsWatcher.onDidDelete((uri) => this.handleFileEvent(uri, "deleted"));
      this.disposables.push(fsWatcher);

      const editWatcher = this.workspace.onDidChangeTextDocument((uri) => {
        if (uri.path.startsWith(baseUri.path)) {
          this.handleEditEvent(uri);
        }
      });
      this.disposables.push(editWatcher);

      // initial load
      const uris = await this.workspace.findFiles(rel);
      for (const uri of uris) {
        const content = (await this.workspace.getTextDocumentContent(uri)) || "";
        this.rebuildIntervalQueue.push({
          thisArg: this,
          uri,
          reason: "created",
          text: content,
        });
      }
    }

    this.rebuildIntervalQueue.start();
  }

  private buildGlobForLanguages(langs: CodeLanguage[]): string {
    const exts = langs.map((l) => CodeLanguageFileExtMap.get(l)).filter((e): e is string => !!e);
    if (exts.length === 0) {
      return "**/*";
    }
    if (exts.length === 1) {
      return `**/*.${exts[0]}`;
    }
    return `**/*.{${exts.join(",")}}`;
  }

  private handleFileEvent(uri: URI, reason: "created" | "changed" | "deleted") {
    const fullText = reason === "deleted" ? undefined : (this.workspace.getTextDocumentContent(uri) as any);
    // push will evaluate lazily in rebuild queue
    this.rebuildIntervalQueue.push({
      thisArg: this,
      uri,
      reason,
      text: undefined as any,
    });
  }

  private async handleEditEvent(uri: URI) {
    const text = (await this.workspace.getTextDocumentContent(uri)) || "";
    this.rebuildIntervalQueue.push({
      thisArg: this,
      uri,
      reason: "changed",
      text,
    });
  }

  private async rebuildCache(uri: URI, reason: "created" | "changed" | "deleted", text?: string | undefined) {
    let didChange = false;
    switch (reason) {
      case "created":
      case "changed":
        // determine language by extension
        const lang = this.inferLanguageFromUri(uri);
        if (!lang) {
          break;
        }
        try {
          const content = text ?? (await this.workspace.getTextDocumentContent(uri));
          const parser = new CodeParser(this.wasmDownloader, lang, this.workspace, this.logger);
          // always read wasm CDN base URL from configuration (do not cache)
          const cfg = this.workspace.getConfiguration("localize-support");
          const wasmCdnBaseUrl = (cfg && cfg.get<string>("wasmCdnBaseUrl")) || "";
          const fragments = await parser
            .parse(this.target.l10nFuncNames, wasmCdnBaseUrl, content, uri as any)
            .catch((_) => []);
          // parser now returns L10nCode (key + location)
          const codes = fragments.map((f: L10nCode) => ({ key: f.key, location: f.location }) as L10nCode);
          this.codes.set(uri.path, codes);
          didChange = true;
        } catch (err) {
          // swallow parse errors — do not propagate to caller
          this.logger.warn("CodeManager.rebuildCache: parse failed", err);
        }
        break;
      case "deleted":
        if (this.codes.has(uri.path)) {
          this.codes.delete(uri.path);
          didChange = true;
        }
        break;
    }

    if (didChange) {
      try {
        this.rebuiltEmitter.emit("rebuilt");
      } catch (err) {
        this.logger.warn("CodeManager.rebuildCache: emitting rebuilt failed", err);
      }
    }
  }

  private inferLanguageFromUri(uri: URI): CodeLanguage | undefined {
    const ext = uri.path.split(".").pop()?.toLowerCase() || "";
    return [...CodeLanguageFileExtMap.entries()].find(([, v]) => v === ext)?.[0] || undefined;
  }

  public async dispose() {
    this.rebuildIntervalQueue.dispose();
    for (const d of this.disposables) {
      try {
        await d.dispose();
      } catch (err) {
        this.logger.warn("CodeManager.dispose: disposing resource failed", err);
      }
    }
    try {
      this.rebuiltEmitter.removeAllListeners();
    } catch (err) {
      this.logger.warn("CodeManager.dispose: removeAllListeners failed", err);
    }
  }
}
