import * as assert from "assert";
import * as http from "http";
import { Utils, URI } from "vscode-uri";
import { copyWorkspaceIfExists, type DisposablePath } from "../unitTestHelper";
import { WasmDownloader, WasmFileNames } from "../../../services/wasmDownloader";
import { CodeLanguage } from "../../../models/l10nTypes";
import { FileStat, FileType } from "../../../models/vscodeTypes";
import sinon from "sinon";
import { MockWorkspaceWrapper, MockLogOutputChannel } from "../mocks/mockVscodeWrapper";

suite("WasmDownloader (unit)", () => {
  let workspace: MockWorkspaceWrapper;

  setup(() => {
    workspace = new MockWorkspaceWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("downloads wasm file, writes to storage and reuses existing file (unit)", async () => {
    // fixture workspace をコピーして URI を用意（実際のファイルI/Oは sinon スタブで扱う）
    const workspaceFixture: DisposablePath | undefined = await copyWorkspaceIfExists("unitTestHelper");
    assert.ok(workspaceFixture, "fixture workspace must exist for unit test");
    const workspacePath = workspaceFixture!.path;
    const workspaceUri = URI.file(workspacePath);

    // small valid-ish wasm binary (magic + version)
    const wasmContent = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const lang: CodeLanguage = "javascript";
    const wasmFileName = WasmFileNames[lang];

    // HTTP server that serves the wasm binary
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (req.url!.endsWith(`/out/${wasmFileName}`)) {
        res.writeHead(200, {
          "Content-Type": "application/wasm",
          "Content-Length": String(wasmContent.length),
        });
        res.end(wasmContent);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    // @ts-ignore address is AddressInfo
    const port: number = (server.address() as any).port;

    // in-memory storage to simulate workspace file storage
    const storage = new Map<string, Uint8Array>();

    // stub workspace methods (MockWorkspaceWrapper + sinon)
    sinon.stub(workspace, "getWorkspaceFolders").returns([{ uri: workspaceUri, name: "unitTestHelper", index: 0 }]);

    sinon.stub(workspace.fs, "createDirectory").resolves();

    sinon.stub(workspace.fs, "writeFile").callsFake(async (uri: URI, content: Uint8Array) => {
      storage.set(uri.fsPath, new Uint8Array(content));
    });

    sinon.stub(workspace.fs, "readFile").callsFake(async (uri: URI) => {
      const v = storage.get(uri.fsPath);
      if (!v) {
        throw new Error("file not found");
      }
      return v;
    });

    sinon.stub(workspace.fs, "stat").callsFake(async (uri: URI) => {
      const p = uri.fsPath;
      if (storage.has(p)) {
        const b = storage.get(p)!;
        return {
          type: 1 as FileType,
          ctime: Date.now(),
          mtime: Date.now(),
          size: b.length,
        } as FileStat;
      }
      // directory checks (storage root) can be treated as existing
      if (p.endsWith(".wasm-test-storage") || p.includes("/wasm/")) {
        return {
          type: 2 as FileType,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 0,
        } as FileStat;
      }
      throw new Error("not found");
    });

    const storageUri = Utils.joinPath(workspaceUri, ".wasm-test-storage");

    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);
    const base = `http://127.0.0.1:${port}/out`;

    const captured: Array<{
      lang: CodeLanguage;
      progress: { downloaded: number; total: number; status: string };
    }> = [];
    const sub = downloader.onDidProgress((l, p) => captured.push({ lang: l, progress: p }));

    let lastProgress: { downloaded: number; total: number } | null = null;
    const localUri = await downloader.retrieveWasmFileInner(base, lang, {
      onProgress: (downloaded: number, total: number) => {
        lastProgress = { downloaded, total };
      },
    });

    // file should exist in stubbed storage and contents must match
    const data = await workspace.fs.readFile(localUri);
    assert.strictEqual(Buffer.from(data).toString("hex"), wasmContent.toString("hex"));

    // progress callback should have been called at least once and show final size
    assert.ok(lastProgress, "onProgress should be called");
    assert.strictEqual((lastProgress as any).total, wasmContent.length);
    assert.strictEqual((lastProgress as any).downloaded, wasmContent.length);

    // EventEmitter 経由の進捗通知と集約状態を確認
    assert.ok(captured.length > 0, "onDidProgress should emit events");
    const finalEvent = captured.filter((c) => c.lang === lang).slice(-1)[0];
    assert.ok(finalEvent, "final progress event must exist");
    assert.strictEqual(finalEvent.progress.status, "done");
    const agg = downloader.getProgress(lang);
    assert.ok(agg, "aggregated progress must be available");
    assert.strictEqual(agg!.status, "done");
    assert.strictEqual(agg!.downloaded, wasmContent.length);
    assert.strictEqual(agg!.total, wasmContent.length);

    // stop server and call ensureWasmFile again — should succeed from cache/local file
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const localUri2 = await downloader.retrieveWasmFileInner(base, lang);
    assert.strictEqual(localUri.fsPath, localUri2.fsPath, "should return same local URI when file exists");

    sub.dispose();
    await workspaceFixture!.dispose();
  }).timeout(30_000);

  test("constructs correct remote URL when base contains {version}", async () => {
    const workspace = new MockWorkspaceWrapper();

    // force download path by making stat throw
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));
    sinon.stub(workspace.fs, "writeFile").resolves();

    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-url-test");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);

    const base = "https://unpkg.com/tree-sitter-wasms@{version}/out";

    let capturedUrl = "";
    // intercept the private downloadFile to capture the remote URL constructed
    const dlStub = sinon.stub(WasmDownloader.prototype as any, "downloadFile").callsFake(async (...args: any[]) => {
      const url = args[0] as string;
      const dest = args[1] as URI;
      capturedUrl = url;
      // simulate a successful write so retrieveWasmFileInner completes
      await workspace.fs.writeFile(dest, new Uint8Array([1]));
    });

    const local = await downloader.retrieveWasmFileInner(base, "javascript");

    // URI may percent-encode reserved characters (e.g. '@' -> '%40') —
    // compare against the decoded form so both encoded/unencoded forms pass.
    assert.strictEqual(
      decodeURI(capturedUrl),
      "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm",
    );

    // ensure returned local uri points to expected filename
    assert.ok(local.fsPath.endsWith("tree-sitter-javascript.wasm"));

    dlStub.restore();
  });

  test("throws when used after dispose", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-dispose-test");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);

    downloader.dispose();
    await assert.rejects(() => downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any), {
      message: "WasmDownloader has been disposed",
    });
  });

  test("concurrent retrieveWasmFile returns same promise and caches result", async () => {
    const workspace = new MockWorkspaceWrapper();
    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-concurrent-test");

    // ensure stat rejects so download path is taken
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));
    sinon.stub(workspace.fs, "createDirectory").resolves();

    const written = new Map<string, Uint8Array>();
    sinon.stub(workspace.fs, "writeFile").callsFake(async (uri: URI, content: Uint8Array) => {
      written.set(uri.fsPath, new Uint8Array(content));
    });

    // stub real downloadFile on prototype to delay and then write a small payload
    const dlStub = sinon.stub(WasmDownloader.prototype as any, "downloadFile").callsFake(async function (this: any, _url: string, dest: URI) {
      await new Promise((r) => setTimeout(r, 20));
      await this.workspace.fs.writeFile(dest, new Uint8Array([1, 2, 3]));
    } as any);

    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);
    const p1 = downloader.retrieveWasmFile("https://cdn.example/out", "javascript" as any);
    const p2 = downloader.retrieveWasmFile("https://cdn.example/out", "javascript" as any);

    // internal cache should contain a promise for this language
    const cache = (downloader as any).promises.get("javascript");
    assert.ok(cache, "promise should be cached");

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1.fsPath, r2.fsPath);
    dlStub.restore();
  });

  test("rejects when remote responds with non-OK status", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));

    // stub global.fetch to return an error-like response
    // @ts-ignore
    const fetchStub = sinon.stub(global as any, "fetch").resolves({ ok: false, status: 404, statusText: "Not Found" });

    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-fetch-error"));
    await assert.rejects(() => downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any), {
      message: /Failed to fetch WASM: 404 Not Found/,
    });

    fetchStub.restore();
  });

  test("throws when response.body is empty", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));

    // @ts-ignore
    const fetchStub = sinon.stub(global as any, "fetch").resolves({ ok: true, headers: new Map(), body: null });

    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-body-null"));
    await assert.rejects(() => downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any), {
      message: /Response body is empty/,
    });

    fetchStub.restore();
  });

  test("handles readable-stream getReader() path and reports progress", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));

    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-reader-test");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);

    const written: { dest?: string; data?: Uint8Array } = {};
    sinon.stub(workspace.fs, "writeFile").callsFake(async (uri: URI, content: Uint8Array) => {
      written.dest = uri.fsPath;
      written.data = new Uint8Array(content);
    });

    // fake Response with body.getReader()
    const fakeBody = {
      getReader() {
        let calls = 0;
        return {
          async read() {
            calls++;
            if (calls === 1) {
              return { done: false, value: new Uint8Array([9, 8]) };
            }
            return { done: true, value: undefined };
          },
          releaseLock() {},
        } as any;
      },
    };

    // @ts-ignore
    const fetchStub = sinon.stub(global as any, "fetch").resolves({ ok: true, headers: new Map([["content-length", "2"]]), body: fakeBody, arrayBuffer: async () => new ArrayBuffer(0) });

    let lastProgress: { downloaded: number; total: number } | null = null;
    const local = await downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any, {
      onProgress: (d, t) => {
        lastProgress = { downloaded: d, total: t };
      },
    });

    assert.ok(written.data && written.data.length === 2);
    assert.ok(lastProgress);
    const p: any = lastProgress;
    assert.strictEqual(p.downloaded, 2);
    assert.strictEqual(p.total, 2);
    assert.ok(local.fsPath.endsWith("tree-sitter-javascript.wasm"));

    fetchStub.restore();
  });

  test("arrayBuffer fallback path uses response.arrayBuffer() and reports total=0 when no content-length header", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));

    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-arraybuffer-test");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);

    const written: { dest?: string; data?: Uint8Array } = {};
    sinon.stub(workspace.fs, "writeFile").callsFake(async (uri: URI, content: Uint8Array) => {
      written.dest = uri.fsPath;
      written.data = new Uint8Array(content);
    });

    // stub fetch: no getReader on body, use arrayBuffer()
    // @ts-ignore
    const fetchStub = sinon.stub(global as any, "fetch").resolves({ ok: true, headers: new Map(), body: {}, arrayBuffer: async () => Buffer.from([1, 2, 3]) });

    let lastProgress: { downloaded: number; total: number } | null = null;
    const local = await downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any, {
      onProgress: (d, t) => {
        lastProgress = { downloaded: d, total: t };
      },
    });

    assert.ok(written.data && written.data.length === 3);
    assert.ok(lastProgress);
    const p: any = lastProgress;
    assert.strictEqual(p.downloaded, 3);
    assert.strictEqual(p.total, 0);
    assert.ok(local.fsPath.endsWith("tree-sitter-javascript.wasm"));

    fetchStub.restore();
  });

  test("abort during readable-stream download rejects, releaseLock called and writeFile not called", async () => {
    const workspace = new MockWorkspaceWrapper();
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "stat").rejects(new Error("not found"));

    const storageUri = Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-abort-test");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), storageUri);

    let writeCalled = false;
    sinon.stub(workspace.fs, "writeFile").callsFake(async () => {
      writeCalled = true;
    });

    let releaseCalled = false;
    const fakeBody = {
      getReader() {
        return {
          async read() {
            // resolve after a short delay so test can call dispose()
            await new Promise((r) => setTimeout(r, 40));
            return { done: true, value: undefined };
          },
          releaseLock() {
            releaseCalled = true;
          },
        } as any;
      },
    };

    // @ts-ignore
    const fetchStub = sinon.stub(global as any, "fetch").resolves({ ok: true, headers: new Map([["content-length", "0"]]), body: fakeBody, arrayBuffer: async () => new ArrayBuffer(0) });

    const p = downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any);
    // abort while reader.read() is pending
    setTimeout(() => downloader.dispose(), 10);

    await assert.rejects(() => p, {
      message: /WasmDownloader disposed/,
    });

    assert.ok(releaseCalled, "reader.releaseLock should be called in finally");
    assert.ok(!writeCalled, "writeFile must not be called when aborted");

    fetchStub.restore();
  });

  test("progress emitter listener throwing is caught and logged", async () => {
    const workspace = new MockWorkspaceWrapper();
    const storage = new Map<string, Uint8Array>();

    sinon.stub(workspace, "getWorkspaceFolders").returns([{ uri: URI.file(process.cwd()), name: "p", index: 0 }]);
    sinon.stub(workspace.fs, "createDirectory").resolves();
    sinon.stub(workspace.fs, "readFile").callsFake(async (u: URI) => storage.get(u.fsPath) || new Uint8Array([1]));
    sinon.stub(workspace.fs, "writeFile").callsFake(async (u: URI, c: Uint8Array) => {
      storage.set(u.fsPath, new Uint8Array(c));
    });
    sinon.stub(workspace.fs, "stat").callsFake(async (u: URI) => ({ type: 1 as any, ctime: Date.now(), mtime: Date.now(), size: 1 } as any));

    const loggerWarn = sinon.stub(MockLogOutputChannel.prototype, "warn");
    const downloader = new WasmDownloader(workspace, new MockLogOutputChannel(), Utils.joinPath(URI.file(process.cwd()), ".tmp/wasm-progress-listener"));

    // add a listener that throws to force the emit() catch path
    const sub = downloader.onDidProgress(() => {
      throw new Error("listener boom");
    });

    // should not throw even if listener throws
    const local = await downloader.retrieveWasmFileInner("https://example.com/out", "javascript" as any);
    assert.ok(local);
    sinon.assert.calledOnce(loggerWarn);

    sub.dispose();
    loggerWarn.restore();
  });
});
