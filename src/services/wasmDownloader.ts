import { CodeLanguage } from "../models/l10nTypes";
import { IWorkspaceService, Disposable } from "../models/vscTypes";
import { URI, Utils } from "vscode-uri";
import { EventEmitter } from "events";

/**
 * wasm 言語別バイナリファイル名
 *
 * バイナリは https://unpkg.com/tree-sitter-wasms@{version}/out/{wasmFileName} にてホストされている
 * @see webページ: https://app.unpkg.com/tree-sitter-wasms@0.1.13/files/out
 */
export const WasmFileNames: Record<CodeLanguage, string> = {
  csharp: "tree-sitter-c_sharp.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  python: "tree-sitter-python.wasm",
  java: "tree-sitter-java.wasm",
};

/** 公開: ダウンロードステータス */
export type WasmDownloadStatus = "idle" | "downloading" | "done" | "failed";

/** 公開: 集約進捗オブジェクト */
export type WasmProgress = { downloaded: number; total: number; status: WasmDownloadStatus };

/** web-tree-sitter 言語別プレビルトバイナリのバージョン */
const WASM_LANGUAGE_VERSION = "0.1.13";

export class WasmDownloader implements Disposable {
  private disposed = false;
  private readonly clsController = new AbortController();
  private readonly promises: Map<CodeLanguage, Promise<URI>> = new Map();

  // 進捗の集約状態
  private readonly progresses: Map<CodeLanguage, WasmProgress> = new Map();
  private readonly progressEmitter = new EventEmitter();

  /**
   *
   * @param workspace
   * @param storageUri
   */
  constructor(
    private workspace: IWorkspaceService,
    private storageUri: URI,
  ) {}

  /**
   * Ensure that the WASM file for the specified language is downloaded and available locally.
   * @example
   * import { Language } from 'web-tree-sitter';
   * import { WasmDownloader } from './wasmDownloader';
   * import { Parser } from "web-tree-sitter";
   * const downloader = new WasmDownloader(workspaceService, storageUri);
   * const uri = await downloader.retrieveWasmFile(wasmCdnBaseUrl, 'javascript');
   * await Parser.init();
   * const parser = new Parser();
   * const JavaScript = await Language.load(uri);
   * parser.setLanguage(JavaScript);
   * @param base URI The base URI where the WASM files are hosted. `{version}` will be replaced with the actual version.
   *            ex: https://unpkg.com/tree-sitter-wasms@{version}/out/
   * @param langType
   * @param options
   * @returns URI The local URI of the downloaded WASM file.
   */
  public async retrieveWasmFile(base: string, langType: CodeLanguage): Promise<URI> {
    if (this.disposed) {
      throw new Error("WasmDownloader has been disposed");
    }
    if (this.promises.has(langType)) {
      return this.promises.get(langType)!;
    }
    const p = this.retrieveWasmFileInner(base, langType);
    this.promises.set(langType, p);
    return p;
  }

  /** 内部実装: ダウンロード済みチェックと実際のダウンロード処理 */
  public async retrieveWasmFileInner(
    base: string,
    langType: CodeLanguage,
    options?: {
      onProgress?: (downloaded: number, total: number) => void;
    },
  ): Promise<URI> {
    if (this.disposed) {
      throw new Error("WasmDownloader has been disposed");
    }

    const wasmDir = Utils.joinPath(this.storageUri, "wasm", WASM_LANGUAGE_VERSION);
    await this.workspace.createDirectory(wasmDir);

    const wasmFileName = WasmFileNames[langType];
    const localWasmUri = Utils.joinPath(wasmDir, wasmFileName);

    try {
      const stat = await this.workspace.stat(localWasmUri);
      // 既に存在する場合は進捗を完了状態にしておく
      const size = stat.size ?? 0;
      this.progresses.set(langType, { downloaded: size, total: size, status: "done" });
      try {
        this.progressEmitter.emit("progress", langType, { downloaded: size, total: size, status: "done" });
      } catch {}
      return localWasmUri;
    } catch {
      // ensure `{version}` placeholder is replaced BEFORE URI encoding/joining,
      // otherwise characters like `{`/`}` are percent-encoded and replace() fails.
      // `base` is a string which may contain the `{version}` placeholder.
      // Replace the placeholder first, then URL-encode the resulting base and
      // append the wasm filename. This avoids percent-encoding braces and
      // ensures the final remote URL is a properly-encoded string.
      const baseWithVersion = base.includes("{version}") ? base.replace("{version}", WASM_LANGUAGE_VERSION) : base;

      // ensure no trailing slash duplication and encode
      const normalizedBase = baseWithVersion.replace(/\/+$/, "");
      const encodedBase = encodeURI(normalizedBase);
      const remoteWasmUrl = `${encodedBase}/${wasmFileName}`;

      // ダウンロード開始前の状態更新
      this.progresses.set(langType, { downloaded: 0, total: 0, status: "downloading" });
      try {
        this.progressEmitter.emit("progress", langType, { downloaded: 0, total: 0, status: "downloading" });
      } catch {}

      // クラスの signal のみを使用。内部 onProgress をラップして集約状態を更新・通知する
      await this.downloadFile(remoteWasmUrl, localWasmUri, {
        signal: this.clsController.signal,
        onProgress: (downloaded: number, total: number) => {
          const prev = this.progresses.get(langType) ?? { downloaded: 0, total: 0, status: "downloading" };
          const newTotal = total || prev.total || 0;
          const newDownloaded = downloaded;
          const newStatus = "downloading" as const;
          this.progresses.set(langType, { downloaded: newDownloaded, total: newTotal, status: newStatus });
          try {
            this.progressEmitter.emit("progress", langType, {
              downloaded: newDownloaded,
              total: newTotal,
              status: newStatus,
            });
          } catch {}

          // 既存のコールバックも呼ぶ
          options?.onProgress?.(downloaded, total);
        },
      });

      // 完了状態に更新して通知
      const final = this.progresses.get(langType) ?? { downloaded: 0, total: 0, status: "done" };
      this.progresses.set(langType, { downloaded: final.downloaded, total: final.total, status: "done" });
      try {
        this.progressEmitter.emit("progress", langType, {
          downloaded: final.downloaded,
          total: final.total,
          status: "done",
        });
      } catch {}

      return localWasmUri;
    }
  }

  private async downloadFile(
    url: string,
    dest: URI,
    options: {
      signal: AbortSignal;
      onProgress?: (downloaded: number, total: number) => void;
    },
  ): Promise<void> {
    const response = await fetch(url, {
      method: "GET",
      signal: options.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }

    const total = parseInt(response.headers.get("content-length") ?? "0", 10);
    let downloaded = 0;

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    // response.body.getReader が使えないランタイム向けにフォールバックを用意
    if (response.body && typeof (response.body as any).getReader === "function") {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      try {
        while (true) {
          // read() 自体も signal を尊重しますが、ループ内でもチェック
          if (options.signal.aborted) {
            throw new Error(String(options.signal.reason ?? "aborted"));
          }

          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            chunks.push(value);
            downloaded += value.length;
            options.onProgress?.(downloaded, total);
          }
        }

        const fullData = new Uint8Array(downloaded);
        let offset = 0;
        for (const chunk of chunks) {
          fullData.set(chunk, offset);
          offset += chunk.length;
        }

        // 書き込み直前の中断チェック
        if (options.signal.aborted) {
          throw new Error(String(options.signal.reason ?? "aborted"));
        }

        await this.workspace.writeFile(dest, fullData);
      } finally {
        if (reader && typeof (reader as any).releaseLock === "function") {
          reader.releaseLock();
        }
      }

      return;
    }

    // フォールバック: ストリーム API が無ければ arrayBuffer() を使う
    const arrayBuf = await response.arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    downloaded = buf.length;
    options.onProgress?.(downloaded, total);

    if (options.signal.aborted) {
      throw new Error(String(options.signal.reason ?? "aborted"));
    }

    await this.workspace.writeFile(dest, buf);
  }

  /**
   * 進捗購読 API
   * listener(lang, {downloaded,total,status})
   */
  public onDidProgress(listener: (lang: CodeLanguage, progress: WasmProgress) => any): Disposable {
    this.progressEmitter.on("progress", listener as any);
    return {
      dispose: () => {
        try {
          (this.progressEmitter as any).off?.("progress", listener as any);
          this.progressEmitter.removeListener("progress", listener as any);
        } catch {}
      },
    };
  }

  /** 指定言語の現在の集約進捗を返す（未開始なら undefined） */
  public getProgress(lang: CodeLanguage): WasmProgress | undefined {
    return this.progresses.get(lang);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.promises.clear();

    try {
      this.progressEmitter.removeAllListeners();
    } catch {}

    this.progresses.clear();

    // 全リクエストを中断
    this.clsController.abort(new Error("WasmDownloader disposed"));
  }
}
