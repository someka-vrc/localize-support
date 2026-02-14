import assert from "assert";
import sinon from "sinon";
import { URI } from "vscode-uri";
import { MockWorkspaceWrapper, MockLogOutputChannel } from "../mocks/mockWorkspaceService";
import { CodeManager } from "../../../services/codeManager";
import { L10nTarget } from "../../../models/l10nTypes";
import { CodeParser } from "../../../services/codeParser";
import { vscTypeHelper, MyRelativePattern, FileType } from "../../../models/vscTypes";

suite("CodeManager (unit)", () => {
  let workspace: MockWorkspaceWrapper;

  setup(() => {
    workspace = new MockWorkspaceWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("init() loads existing code files and emits rebuilt", async () => {
    const sampleUri = URI.file("d:/proj/src/foo.js");
    const code = `t("hello.world");`;

    const wasmBase = "https://cdn.example/{version}/out";
    sinon.stub(workspace, "findFiles").resolves([sampleUri]);
    sinon
      .stub(workspace, "getTextDocumentContent")
      .callsFake(async (u: any) => (u.path === sampleUri.path ? code : ""));
    sinon
      .stub(workspace.fs, "stat")
      .resolves({ type: 2 as FileType, ctime: Date.now(), mtime: Date.now(), size: 0 });
    sinon.stub(workspace as any, "createFileSystemWatcher").callsFake((pattern: any) => {
      const watcher = {
        onDidCreate: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnCreate = cb; return { dispose: () => {} } as any; },
        onDidChange: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnChange = cb; return { dispose: () => {} } as any; },
        onDidDelete: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnDelete = cb; return { dispose: () => {} } as any; },
        dispose: () => {},
      } as any;
      return watcher as any;
    });
    sinon.stub(workspace, "onDidChangeTextDocument").callsFake((cb: any) => {
      (workspace as any)._editCallback = cb;
      return { dispose: () => {} } as any;
    });
    sinon.stub(workspace as any, "getConfiguration").callsFake(() => ({ get: <T>(_k?: string) => wasmBase as unknown as T } as any));

    // stub CodeParser.parse to return a deterministic fragment (avoid wasm)
    const parseStub = sinon.stub((CodeParser as any).prototype, "parse").resolves([
      {
        key: "hello.world",
        location: vscTypeHelper.newLocation(sampleUri, vscTypeHelper.newRange(0, 0, 0, 13)),
      },
    ] as any);

    const target: L10nTarget = {
      codeLanguages: ["javascript" as any],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    };

    const mgr = new CodeManager(workspace, new MockLogOutputChannel(), target, 10);

    let rebuilt = false;
    const sub = mgr.onRebuilt(() => (rebuilt = true));

    await mgr.init();

    // wait for rebuilt
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("rebuilt event not fired")), 500);
      const iv = setInterval(() => {
        if (rebuilt) {
          clearTimeout(to);
          clearInterval(iv);
          resolve();
        }
      }, 10);
    });

    // ensure parser received wasmCdnBaseUrl from configuration
    sinon.assert.calledOnce(parseStub);
    assert.strictEqual(parseStub.firstCall.args[1], wasmBase);

    const keys = Array.from(mgr.codes.keys());
    assert.ok(keys.includes(sampleUri.path));
    const parsed = mgr.codes.get(sampleUri.path);
    assert.ok(parsed && parsed.length > 0);
    assert.strictEqual(parsed![0].key, "hello.world");

    sub.dispose();
    await mgr.dispose();
  });

  test("handles changed and deleted events and dispose prevents further updates", async () => {
    const uri = URI.file("d:/proj/src/foo.js");
    const initial = `t("A");`;
    const changed = `t("B");`;

    sinon.stub(workspace, "findFiles").resolves([uri]);
    sinon.stub(workspace, "getTextDocumentContent").callsFake(async (u: any) => (u.path === uri.path ? initial : ""));
    sinon
      .stub(workspace.fs, "stat")
      .resolves({ type: 2 as FileType, ctime: Date.now(), mtime: Date.now(), size: 0 });
    sinon.stub(workspace as any, "createFileSystemWatcher").callsFake((pattern: any) => {
      const watcher = {
        onDidCreate: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnCreate = cb; return { dispose: () => {} } as any; },
        onDidChange: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnChange = cb; return { dispose: () => {} } as any; },
        onDidDelete: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnDelete = cb; return { dispose: () => {} } as any; },
        dispose: () => {},
      } as any;
      return watcher as any;
    });
    sinon.stub(workspace, "onDidChangeTextDocument").callsFake((cb: any) => {
      (workspace as any)._editCallback = cb;
      return { dispose: () => {} } as any;
    });

    // parse stub returns different values depending on content (simulate)
    const wasmBase = "https://cdn.example/{version}/out";
    sinon.stub(workspace as any, "getConfiguration").callsFake(() => ({ get: <T>(_k?: string) => wasmBase as unknown as T } as any));
    const parseStub = sinon.stub((CodeParser as any).prototype, "parse");
    parseStub.callsFake(async (...args: any[]) => {
      const content: string = args[2] || "";
      const uriArg: URI = args[3];
      if (content.includes('"A"')) {
        return [{ key: "A", location: vscTypeHelper.newLocation(uriArg, vscTypeHelper.newRange(0, 0, 0, 3)) }];
      }
      return [{ key: "B", location: vscTypeHelper.newLocation(uriArg, vscTypeHelper.newRange(0, 0, 0, 3)) }];
    });

    const target: L10nTarget = {
      codeLanguages: ["javascript" as any],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    };

    const mgr = new CodeManager(workspace, new MockLogOutputChannel(), target, 10);

    let rebuildCount = 0;
    const sub = mgr.onRebuilt(() => rebuildCount++);

    await mgr.init();

    // wait for initial load
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("initial rebuild not fired")), 500);
      const iv = setInterval(() => {
        if (rebuildCount >= 1) {
          clearTimeout(to);
          clearInterval(iv);
          res();
        }
      }, 10);
    });

    // ensure parser received wasmCdnBaseUrl from configuration on initial parse
    sinon.assert.calledOnce(parseStub);
    assert.strictEqual(parseStub.firstCall.args[1], wasmBase);

    // simulate edit event
    (workspace as any).getTextDocumentContent = async (u: URI) => (u.path === uri.path ? changed : "");
    (workspace as any)._editCallback(uri);

    // wait for changed event to be processed
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("changed rebuild not fired")), 500);
      const iv = setInterval(() => {
        if (rebuildCount >= 2) {
          clearTimeout(to);
          clearInterval(iv);
          res();
        }
      }, 10);
    });

    const parsed = mgr.codes.get(uri.path);
    assert.ok(parsed && parsed.length > 0);
    assert.strictEqual(parsed![0].key, "B");

    // simulate delete via fsWatcher callback
    (workspace as any)._fsWatcherOnDelete(uri);

    // wait for delete to be processed
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("deleted rebuild not fired")), 500);
      const iv = setInterval(() => {
        if (!mgr.codes.has(uri.path)) {
          clearTimeout(to);
          clearInterval(iv);
          res();
        }
      }, 10);
    });

    assert.ok(!mgr.codes.has(uri.path));

    // dispose and ensure further events are ignored
    await mgr.dispose();
    const prev = rebuildCount;
    (workspace as any)._editCallback(uri);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(rebuildCount, prev, "no rebuild after dispose");

    sub.dispose();
  });
});
