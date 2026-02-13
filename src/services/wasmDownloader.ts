import { CodeLanguage, WasmFileNames } from "../models/l10nTypes";
import { IWorkspaceService, MyDisposable } from "../models/vscTypes";
import { URI, Utils } from "vscode-uri";

/** web-tree-sitter 言語別プレビルトバイナリのバージョン */
const WASM_LANGUAGE_VERSION = "0.1.13";

export class WasmDownloader implements MyDisposable {
  private _disposed = false;
  private readonly _clsController = new AbortController();

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
   * const downloader = new WasmDownloader(workspaceService, storageUri);
   * const uri = await downloader.ensureWasmFile(wasmCdnBaseUrl, 'javascript');
   * import { Parser } from "npm:web-tree-sitter";
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
  public async ensureWasmFile(
    base: URI,
    langType: CodeLanguage,
    options?: {
      onProgress?: (downloaded: number, total: number) => void;
    },
  ): Promise<URI> {
    if (this._disposed) {
      throw new Error("WasmDownloader has been disposed");
    }

    const wasmDir = Utils.joinPath(this.storageUri, "wasm", WASM_LANGUAGE_VERSION);
    await this.workspace.createDirectory(wasmDir);

    const wasmFileName = WasmFileNames[langType];
    const localWasmUri = Utils.joinPath(wasmDir, wasmFileName);

    try {
      await this.workspace.stat(localWasmUri);
      return localWasmUri;
    } catch {
      const remoteWasmUrl = Utils.joinPath(base, wasmFileName)
        .toString()
        .replace("{version}", WASM_LANGUAGE_VERSION);

      // クラスの signal のみを使用
      await this.downloadFile(remoteWasmUrl, localWasmUri, {
        signal: this._clsController.signal,
        onProgress: options?.onProgress,
      });
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
      throw new Error(
        `Failed to fetch WASM: ${response.status} ${response.statusText}`,
      );
    }

    const total = parseInt(response.headers.get("content-length") ?? "0", 10);
    let downloaded = 0;

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        // read() 自体も signal を尊重しますが、ループ内でもチェック
        if (options.signal.aborted) {
          throw options.signal.reason;
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
        throw options.signal.reason;
      }

      await this.workspace.writeFile(dest, fullData);
    } finally {
      reader.releaseLock();
    }
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    // 全リクエストを中断
    this._clsController.abort(new Error("WasmDownloader disposed"));
  }
}
