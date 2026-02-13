import {
  MyDisposable,
  MyRelativePattern,
  IWorkspaceService,
} from "../models/vscTypes";
import { URI } from "vscode-uri";
import { EventEmitter } from "events";
import { L10nTarget } from "../models/l10nTypes";
import { normalizeDirPath } from "../utils/util";
import { getL10nParser, TranslationParseResult } from "./translationParser";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";

type RebuildQueueItem = {
  thisArg: TranslationManager;
  uri: URI;
  reason: "created" | "changed" | "deleted";
  text?: string;
};

export class TranslationManager implements MyDisposable {
  private readonly disposables: { [key: string]: MyDisposable[] } = {};
  /**
   * ローカライズファイルのパース結果
   * key: ファイルの Uri
   * value: パース結果
   */
  public readonly l10ns: Map<URI, TranslationParseResult> = new Map();
  private readonly rebuildQueue: RebuildQueueItem[] = [];
  private disposed: boolean = false;
  private l10nTimeoutId: NodeJS.Timeout = null as any;
  private readonly rebuildIntervalQueue: IntervalQueue<RebuildQueueItem>;
  private readonly rebuiltEmitter = new EventEmitter();

  constructor(
    private workspace: IWorkspaceService,
    public target: L10nTarget,
    rebuildIntervalMs: number = 500,
  ) {
    this.rebuildIntervalQueue = new IntervalQueue<RebuildQueueItem>(
      rebuildIntervalMs,
      async (item: RebuildQueueItem) =>
        await item.thisArg.rebuildCache(item.uri, item.reason, item.text),
      OrganizeStrategies.skipDuplicatesByKey<RebuildQueueItem>(
        (item) => item.uri.path + "-" + item.reason,
      ),
    );
  }

  /**
   * 再構築完了イベントの購読を開始する
   * @param listener イベントリスナー
   * @returns MyDisposable オブジェクト
   */
  public onRebuilt(listener: () => any): MyDisposable {
    this.rebuiltEmitter.on("rebuilt", listener);
    return {
      dispose: () => {
        try {
          // Node 10+ supports off()
          (this.rebuiltEmitter as any).off?.("rebuilt", listener);
          // fallback
          this.rebuiltEmitter.removeListener("rebuilt", listener as any);
        } catch {}
      },
    } as MyDisposable;
  }

  public async init() {
    if (this.disposed) {
      return;
    }
    if (
      this.target.codeLanguages.length === 0 ||
      this.target.codeDirs.length === 0 ||
      this.target.l10nDirs.length === 0 ||
      this.target.l10nFuncNames.length === 0
    ) {
      // 無効ターゲットなので何もしない
      return;
    }

    // ファイル監視
    const baseUri = await normalizeDirPath(
      this.workspace,
      this.target.settingsLocation,
    );
    if (!baseUri) {
      throw new Error("Failed to normalize base directory path.");
    }
    const l10nFilePattern = {
      baseUri,
      pattern: "**/*" + this.target.l10nExtension,
    } as MyRelativePattern;
    const fsWatcher = this.workspace.createFileSystemWatcher(
      l10nFilePattern,
      (type, uri) => this.handleL10nFileEvent(uri, type),
    );
    this.disposables["fsWatcher"] = [fsWatcher];

    const editWatcher = this.workspace.onDidChangeTextDocument((uri) => {
      // 監視対象フォルダ配下のファイルかチェック
      if (uri.path.startsWith(baseUri.path)) {
        this.handleL10nChangeEvent(uri);
      }
    });
    this.disposables["editWatcher"] = [editWatcher];

    // 初期ロード
    const uris = await this.workspace.findFiles(l10nFilePattern);
    for (const uri of uris) {
      const content = (await this.workspace.getTextDocumentContent(uri)) || "";
      this.rebuildIntervalQueue.push({
        thisArg: this,
        uri,
        reason: "created",
        text: content,
      });
    }
    this.rebuildIntervalQueue.start();
  }

  /**
   * fsWatcher イベントハンドラ
   * @param uri
   * @param reason
   */
  private async handleL10nFileEvent(
    uri: URI,
    reason: "created" | "changed" | "deleted",
  ): Promise<void> {
    const fullText =
      reason === "deleted"
        ? undefined
        : (await this.workspace.getTextDocumentContent(uri)) || "";
    this.rebuildIntervalQueue.push({ thisArg: this, uri, reason, text: fullText });
  }

  /**
   * テキストドキュメント変更イベントハンドラ
   * @param uri 変更されたドキュメントの Uri
   */
  private async handleL10nChangeEvent(uri: URI) {
    this.rebuildIntervalQueue.push({
      thisArg: this,
      uri: uri,
      reason: "changed",
      text: (await this.workspace.getTextDocumentContent(uri)) || "",
    });
  }

  /**
   * キャッシュを再構築する
   * @param uri 対象ファイルの Uri
   * @param reason イベントの理由
   * @param text ファイルの内容（削除の場合は undefined）
   */
  private async rebuildCache(
    uri: URI,
    reason: "created" | "changed" | "deleted",
    text: string | undefined,
  ) {
    let didChange = false;
    switch (reason) {
      case "created":
        if (text) {
          const parser = getL10nParser(this.target.l10nFormat);
          if (parser) {
            await parser.parse(uri, text).then((result) => {
              this.l10ns.set(uri, result);
              didChange = true;
            });
          }
        }
        break;
      case "changed":
        if (text) {
          const parser = getL10nParser(this.target.l10nFormat);
          if (parser) {
            await parser.parse(uri, text).then((result) => {
              this.l10ns.set(uri, result);
              didChange = true;
            });
          }
        }
        break;
      case "deleted":
        if (this.l10ns.has(uri)) {
          this.l10ns.delete(uri);
          didChange = true;
        }
        break;
    }

    if (didChange) {
      try {
        this.rebuiltEmitter.emit("rebuilt");
      } catch {}
    }
  }

  public async dispose() {
    this.disposed = true;
    this.rebuildIntervalQueue.dispose();
    if (this.l10nTimeoutId) {
      clearTimeout(this.l10nTimeoutId);
    }
    this.rebuildQueue.length = 0;
    for (const key in this.disposables) {
      for (const disposable of this.disposables[key]) {
        try {
          await disposable.dispose();
        } catch {}
      }
    }

    try {
      this.rebuiltEmitter.removeAllListeners();
    } catch {}
  }
}
