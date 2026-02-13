import * as assert from "assert";
import * as http from "http";
import { Utils, URI } from "vscode-uri";
import { copyWorkspaceIfExists, type DisposablePath } from "../unitTestHelper";
import { WasmDownloader } from "../../../services/wasmDownloader";
import { CodeLanguage, WasmFileNames } from "../../../models/l10nTypes";
import { MyFileStat, MyFileType } from "../../../models/vscTypes";
import sinon from "sinon";
import { MockWorkspaceService } from "../mocks/mockWorkspaceService";

suite("WasmDownloader (unit)", () => {
  let workspace: MockWorkspaceService;

  setup(() => {
    workspace = new MockWorkspaceService();
  });

  teardown(() => {
    sinon.restore();
  });

  test("downloads wasm file, writes to storage and reuses existing file (unit)", async () => {
    // fixture workspace をコピーして URI を用意（実際のファイルI/Oは sinon スタブで扱う）
    const workspaceFixture: DisposablePath | undefined =
      await copyWorkspaceIfExists("unitTestHelper");
    assert.ok(workspaceFixture, "fixture workspace must exist for unit test");
    const workspacePath = workspaceFixture!.path;
    const workspaceUri = URI.file(workspacePath);

    // small valid-ish wasm binary (magic + version)
    const wasmContent = Buffer.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);
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

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    // @ts-ignore address is AddressInfo
    const port: number = (server.address() as any).port;

    // in-memory storage to simulate workspace file storage
    const storage = new Map<string, Uint8Array>();

    // stub workspace methods (MockWorkspaceService + sinon)
    sinon
      .stub(workspace, "getWorkspaceFolders")
      .returns([{ uri: workspaceUri, name: "unitTestHelper", index: 0 }]);

    sinon.stub(workspace, "createDirectory").resolves();

    sinon
      .stub(workspace, "writeFile")
      .callsFake(async (uri: URI, content: Uint8Array) => {
        storage.set(uri.fsPath, new Uint8Array(content));
      });

    sinon.stub(workspace, "readFile").callsFake(async (uri: URI) => {
      const v = storage.get(uri.fsPath);
      if (!v) {
        throw new Error("file not found");
      }
      return v;
    });

    sinon.stub(workspace, "stat").callsFake(async (uri: URI) => {
      const p = uri.fsPath;
      if (storage.has(p)) {
        const b = storage.get(p)!;
        return {
          type: MyFileType.File,
          ctime: Date.now(),
          mtime: Date.now(),
          size: b.length,
        } as MyFileStat;
      }
      // directory checks (storage root) can be treated as existing
      if (p.endsWith(".wasm-test-storage") || p.includes("/wasm/")) {
        return {
          type: MyFileType.Directory,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 0,
        } as MyFileStat;
      }
      throw new Error("not found");
    });

    const storageUri = Utils.joinPath(workspaceUri, ".wasm-test-storage");

    const downloader = new WasmDownloader(workspace, storageUri);
    const base = URI.parse(`http://127.0.0.1:${port}/out`);

    let lastProgress: { downloaded: number; total: number } | null = null;
    const localUri = await downloader.ensureWasmFile(base, lang, {
      onProgress: (downloaded: number, total: number) => {
        lastProgress = { downloaded, total };
      },
    });

    // file should exist in stubbed storage and contents must match
    const data = await workspace.readFile(localUri);
    assert.strictEqual(
      Buffer.from(data).toString("hex"),
      wasmContent.toString("hex"),
    );

    // progress callback should have been called at least once and show final size
    assert.ok(lastProgress, "onProgress should be called");
    assert.strictEqual((lastProgress as any).total, wasmContent.length);
    assert.strictEqual((lastProgress as any).downloaded, wasmContent.length);

    // stop server and call ensureWasmFile again — should succeed from cache/local file
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const localUri2 = await downloader.ensureWasmFile(base, lang);
    assert.strictEqual(
      localUri.fsPath,
      localUri2.fsPath,
      "should return same local URI when file exists",
    );

    await workspaceFixture!.dispose();
  }).timeout(30_000);
});
