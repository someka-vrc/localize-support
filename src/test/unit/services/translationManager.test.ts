import assert from "assert";
import { TranslationManager } from "../../../services/translationManager";
import { Disposable, MyRelativePattern, FileType } from "../../../models/vscTypes";
import { URI } from "vscode-uri";
import { L10nTarget } from "../../../models/l10nTypes";
import sinon from "sinon";
import { MockWorkspaceWrapper, MockLogOutputChannel } from "../mocks/mockWorkspaceService";

suite("TranslationManager (unit)", () => {
  let workspace: MockWorkspaceWrapper;
  setup(() => {
    workspace = new MockWorkspaceWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("init() loads existing .po files and emits rebuilt", async () => {
    const poContent = 'msgid "Hello"\nmsgstr "こんにちは"\n';
    const sampleUri = URI.file("d:/proj/locales/en.po");

    sinon.stub(workspace, "findFiles").resolves([sampleUri]);
    sinon.stub(workspace, "getTextDocumentContent").callsFake(async (uri: URI) => {
      return uri.path === sampleUri.path ? poContent : "";
    });
    sinon.stub(workspace.fs, "stat").resolves({
      type: 2 as FileType,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
    } as any);
    // validate l10n dirs used by normalizeDirPath
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);
    sinon.stub(workspace as any, "createFileSystemWatcher").callsFake((pattern: any) => {
      const watcher = {
        onDidCreate: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnCreate = cb; return { dispose: () => {} } as any; },
        onDidChange: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnChange = cb; return { dispose: () => {} } as any; },
        onDidDelete: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnDelete = cb; return { dispose: () => {} } as any; },
        dispose: () => {},
      } as any;
      return watcher as any;
    });
    sinon.stub(workspace as any, "onDidChangeTextDocument").callsFake((cb: any) => {
      (workspace as any)._editCallback = cb;
      return { dispose: () => {} } as any;
    });
    sinon.stub(workspace as any, "getConfiguration").callsFake(() => ({ get: <T>() => undefined } as any));

    const target: L10nTarget = {
      codeLanguages: ["javascript" as any],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    };

    const mgr = new TranslationManager(workspace, new MockLogOutputChannel(), target, 10);

    let rebuilt = false;
    const disp = mgr.onRebuilt(() => (rebuilt = true));

    await mgr.init();

    // wait until the rebuild event is emitted (IntervalQueue processes immediately)
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

    // ensure l10ns has an entry for the sampleUri
    const keys = Array.from(mgr.l10ns.keys());
    assert.ok(keys.includes(sampleUri.path), "l10ns should contain parsed uri");
    const parsed = mgr.l10ns.get(sampleUri.path);
    assert.ok(parsed && parsed.entries);

    disp.dispose();
    await mgr.dispose();
  });

  test("handles changed and deleted events and dispose prevents further updates", async () => {
    const uri = URI.file("d:/proj/locales/en.po");
    const initial = 'msgid "A"\nmsgstr "一"\n';
    const changed = 'msgid "A"\nmsgstr "壱"\n';

    sinon.stub(workspace, "findFiles").resolves([uri]);
    sinon.stub(workspace, "getTextDocumentContent").callsFake(async (u: any) => {
      return u.path === uri.path ? initial : "";
    });
    sinon.stub(workspace.fs, "stat").resolves({
      type: 2 as FileType,
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
    } as any);
    // validate l10n dirs used by normalizeDirPath
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);
    sinon.stub(workspace as any, "createFileSystemWatcher").callsFake((pattern: any) => {
      const watcher = {
        onDidCreate: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnCreate = cb; return { dispose: () => {} } as any; },
        onDidChange: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnChange = cb; return { dispose: () => {} } as any; },
        onDidDelete: (cb: (u: URI) => void) => { (workspace as any)._fsWatcherOnDelete = cb; return { dispose: () => {} } as any; },
        dispose: () => {},
      } as any;
      return watcher as any;
    });
    sinon.stub(workspace as any, "onDidChangeTextDocument").callsFake((cb: any) => {
      (workspace as any)._editCallback = cb;
      return { dispose: () => {} } as any;
    });
    sinon.stub(workspace as any, "getConfiguration").callsFake(() => ({ get: <T>() => undefined } as any));

    const target: L10nTarget = {
      codeLanguages: ["javascript" as any],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    };

    const mgr = new TranslationManager(workspace, new MockLogOutputChannel(), target, 10);

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

    // simulate edit event (onDidChangeTextDocument)
    workspace.getTextDocumentContent = async (u: URI) => (u.path === uri.path ? changed : "");
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

    // verify cache updated
    const parsed = mgr.l10ns.get(uri.path);
    if (!parsed) {
      assert.fail("parsed should not be undefined");
    }
    assert.ok(parsed.entries["en"], "parsed entries should include 'en' language");
    assert.strictEqual(parsed.entries["en"]["A"].translation, "壱");

    // simulate delete via fsWatcher callback
    (workspace as any)._fsWatcherOnDelete(uri);

    // wait for delete to be processed
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("deleted rebuild not fired")), 500);
      const iv = setInterval(() => {
        if (!mgr.l10ns.has(uri.path)) {
          clearTimeout(to);
          clearInterval(iv);
          res();
        }
      }, 10);
    });

    assert.ok(!mgr.l10ns.has(uri.path));

    // dispose and ensure further events are ignored
    await mgr.dispose();
    const prev = rebuildCount;
    // simulate another change after dispose
    (workspace as any)._editCallback(uri);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(rebuildCount, prev, "no rebuild after dispose");

    sub.dispose();
  });
});
