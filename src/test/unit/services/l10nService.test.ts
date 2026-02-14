import * as assert from "assert";
import sinon from "sinon";
import { URI } from "vscode-uri";
import { MockWorkspaceWrapper, MockLogOutputChannel } from "../mocks/mockWorkspaceService";
import { L10nService } from "../../../services/l10nService";
import { L10nTargetManager } from "../../../services/l10nTargetManager";
import { vscTypeHelper } from "../../../models/vscTypes";

suite("L10nService (unit)", () => {
  let workspace: MockWorkspaceWrapper;
  let svc: L10nService;

  setup(() => {
    workspace = new MockWorkspaceWrapper();
    svc = new L10nService(workspace as any, new MockLogOutputChannel(), 10);
  });

  teardown(() => {
    sinon.restore();
  });

  test("reload() records diagnostic when readFile throws (unit)", async () => {
    const uri = URI.file("/path/to/localize-support.json");
    sinon.stub(workspace.fs, "readFile").rejects(new Error("read-failure"));

    await svc.reload(uri);

    const { diags, statuses } = svc.getDiagnostics();
    assert.strictEqual(statuses.length, 0);
    // diagnostic map should contain an entry for the settings URI
    const d = diags.get(uri.path);
    assert.ok(d && d.length > 0, "diagnostic must be present for failed read");
    const msg = d![0].message;
    assert.ok(msg.includes("Failed to read settings file"));
  });

  test("normalizeSettingsObject normalizes dirs and reports missing ones (unit)", async () => {
    const settingUri = URI.file("/workspace/localize-support.json");

    // stub validateDirectoryPath to accept only the specific existing dirs
    sinon.stub(workspace.fs, "validateDirectoryPath").callsFake(async (uri: URI) => {
      const p = uri.path;
      return p.endsWith("/src/exists") || p.endsWith("/locale");
    });

    const rawTargets = [
      {
        codeLanguages: ["javascript"],
        codeDirs: ["./src/exists", "./src/missing"],
        l10nDirs: ["./locale", "./locale/missing"],
        l10nFuncNames: ["_"],
        l10nFormat: "po",
        l10nExtension: ".po",
      },
    ];

    const res = await svc.normalizeSettingsObject(rawTargets, settingUri);
    assert.strictEqual(res.targets.length, 1);
    const t = res.targets[0];
    // only the existing code dir should be normalized
    assert.strictEqual(t.codeDirs.length, 1);
    assert.ok(t.codeDirs[0].path.endsWith("/src/exists"));
    // only the existing l10n dir should be normalized
    assert.strictEqual(t.l10nDirs.length, 1);
    assert.ok(t.l10nDirs[0].path.endsWith("/locale"));
    // messages should mention the missing entries
    assert.ok(res.messages.some((m) => m.includes("Code directory './src/missing' does not exist.")));
    assert.ok(res.messages.some((m) => m.includes("Localization directory './locale/missing' does not exist.")));
  });

  test("reload() with invalid workspace index records status (unit)", async () => {
    // workspace with no folders
    sinon.stub(workspace, "getWorkspaceFolders").returns([]);

    await svc.reload(99);

    const { diags, statuses } = svc.getDiagnostics();
    assert.strictEqual(diags.size, 0);
    assert.ok(statuses.some((s) => s.includes("Workspace folder index 99 is out of range.")));
  });

  test("getDiagnostics() merges manager match diagnostics", () => {
    // create a manager and inject into service.managers
    const target = {
      codeLanguages: ["javascript"],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    } as any;

    const mgr = new L10nTargetManager(workspace as any, new MockLogOutputChannel(), target, 1);

    const codeUri = URI.file("d:/proj/src/foo.js");
    mgr.codes.set(codeUri.path, [
      { key: "missing.key", location: vscTypeHelper.newLocation(codeUri, vscTypeHelper.newRange(0, 0, 0, 10)) },
    ] as any);

    // inject into service.managers under arbitrary setting path
    (svc as any).managers.set("/path/to/setting", [{ manager: mgr, listenerDisposable: { dispose: () => {} } }]);

    const { diags } = svc.getDiagnostics();
    const codeDiags = diags.get(codeUri.path) || [];
    assert.ok(codeDiags.some((d) => /missing.key/.test(d.message)));
  });

  test("getKeyAtPosition() returns key from code and .po; position outside returns null", () => {
    const target = {
      codeLanguages: ["javascript"],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    } as any;

    const mgr = new L10nTargetManager(workspace as any, new MockLogOutputChannel(), target, 1);

    const codeUri = URI.file("d:/proj/src/app.js");
    const codeRange = vscTypeHelper.newRange(3, 2, 3, 20);
    mgr.codes.set(codeUri.path, [
      { key: "code.key", location: vscTypeHelper.newLocation(codeUri, codeRange) },
    ] as any);

    const luri = URI.file("d:/proj/locales/en.po");
    mgr.l10ns.set(luri.path, {
      success: true,
      diagnostics: [],
      entries: {
        en: {
          "po.key": {
            translation: "v",
            location: vscTypeHelper.newLocation(luri, vscTypeHelper.newRange(10, 0, 10, 7)),
          },
        },
      },
    } as any);

    (svc as any).managers.set("/path/to/setting", [{ manager: mgr, listenerDisposable: { dispose: () => {} } }]);

    // inside code range
    const keyFromCode = svc.getKeyAtPosition(codeUri, { line: 3, character: 5 } as any);
    assert.strictEqual(keyFromCode, "code.key");

    // outside any known range
    const none = svc.getKeyAtPosition(codeUri, { line: 0, character: 0 } as any);
    assert.strictEqual(none, null);

    // inside po msgid range
    const keyFromPo = svc.getKeyAtPosition(luri, { line: 10, character: 2 } as any);
    assert.strictEqual(keyFromPo, "po.key");
  });

  test("findTranslationLocationsForKey / findCodeReferencesForKey / findDefinition / findReferences", () => {
    const target = {
      codeLanguages: ["javascript"],
      codeDirs: [URI.file("d:/proj/src")],
      l10nFormat: "po",
      l10nDirs: [URI.file("d:/proj/locales")],
      l10nExtension: ".po",
      l10nFuncNames: ["t"],
      settingsLocation: URI.file("d:/proj"),
    } as any;

    const mgr = new L10nTargetManager(workspace as any, new MockLogOutputChannel(), target, 1);

    const codeUri = URI.file("d:/proj/src/foo.js");
    const codeLoc = vscTypeHelper.newLocation(codeUri, vscTypeHelper.newRange(0, 0, 0, 10));
    mgr.codes.set(codeUri.path, [ { key: "greet", location: codeLoc } ] as any);

    const en = URI.file("d:/proj/locales/en.po");
    const entryLoc = vscTypeHelper.newLocation(en, vscTypeHelper.newRange(1, 0, 1, 5));
    mgr.l10ns.set(en.path, {
      success: true,
      diagnostics: [],
      entries: { en: { greet: { translation: "hi", location: entryLoc } } },
    } as any);

    (svc as any).managers.set("/path/to/setting", [{ manager: mgr, listenerDisposable: { dispose: () => {} } }]);

    const trans = svc.findTranslationLocationsForKey("greet");
    assert.strictEqual(trans.length, 1);
    assert.strictEqual(trans[0].uri.path, en.path);

    const translations = svc.getTranslationsForKey("greet");
    assert.strictEqual(translations.length, 1);
    assert.strictEqual(translations[0].translation, "hi");
    assert.strictEqual(translations[0].uri.path, en.path);
    assert.strictEqual(translations[0].fileName, "en.po");
    assert.strictEqual(translations[0].lang, "en");
    assert.ok(translations[0].location);
    assert.strictEqual(translations[0].location!.uri.path, en.path);
    assert.strictEqual(translations[0].location!.range.start.line, 1);

    const refs = svc.findCodeReferencesForKey("greet");
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].uri.path, codeUri.path);

    const def = svc.findDefinition(codeUri, { line: 0, character: 1 } as any);
    assert.strictEqual(def.length, 1);
    assert.strictEqual(def[0].uri.path, en.path);

    const foundRefs = svc.findReferences(en, { line: 1, character: 1 } as any);
    assert.strictEqual(foundRefs.length, 1);
    assert.strictEqual(foundRefs[0].uri.path, codeUri.path);
  });

  test("init() registers watchers and calls reload for found settings", async () => {
    const settingUri = URI.file("/ws/localize-support.json");
    sinon.stub(workspace, "findFiles").resolves([settingUri]);

    const reloadStub = sinon.stub(svc, "reload").resolves();

    const fsWatcher = {
      onDidCreate: (_cb: any) => {},
      onDidChange: (_cb: any) => {},
      onDidDelete: (_cb: any) => {},
      dispose: sinon.spy(),
    } as any;
    const createWatcherStub = sinon.stub(workspace, "createFileSystemWatcher").returns(fsWatcher);
    const cfgStub = sinon.stub(workspace, "onDidChangeConfiguration").returns({ dispose: sinon.spy() } as any);

    await svc.init();

    assert.ok(reloadStub.calledWith(settingUri));
    assert.ok(createWatcherStub.calledOnce);
    assert.ok(cfgStub.calledOnce);

    // dispose service to stop the background reloadIntervalQueue started by init()
    await svc.dispose();
  });

  test("disposeManagersBySetting disposes manager and clears maps", async () => {
    const mgrSpy = { dispose: sinon.spy() } as any;
    const ld = { dispose: sinon.spy() } as any;
    (svc as any).managers.set("/setting/path", [{ manager: mgrSpy, listenerDisposable: ld }]);
    (svc as any).settingDiags.set("/setting/path", { type: "diagnostic", diagnostics: { uri: URI.file("/x"), diagnostics: [] } } as any);

    await svc.disposeManagersBySetting("/setting/path");

    assert.ok(mgrSpy.dispose.calledOnce);
    assert.ok(ld.dispose.calledOnce);
    assert.strictEqual((svc as any).managers.has("/setting/path"), false);
    assert.strictEqual((svc as any).settingDiags.has("/setting/path"), false);
  });

  test("unload() delegates to disposeManagersBySetting", async () => {
    const uri = URI.file("/my/settings/localize-support.json");
    const mgrSpy = { dispose: sinon.spy() } as any;
    const ld = { dispose: sinon.spy() } as any;
    (svc as any).managers.set(uri.path, [{ manager: mgrSpy, listenerDisposable: ld }]);

    await svc.unload(uri);

    assert.strictEqual((svc as any).managers.has(uri.path), false);
    assert.ok(mgrSpy.dispose.calledOnce);
  });

  test("normalizeSettingsObject handles empty rawTargets for config source", async () => {
    const res = await svc.normalizeSettingsObject([], 0);
    assert.strictEqual(res.targets.length, 0);
    assert.strictEqual(res.messages.length, 0);
  });

  test("normalizeSettingsObject handles invalid target entry and defaults", async () => {
    const uri = URI.file("/w/localize-support.json");
    const res = await svc.normalizeSettingsObject([null as any], uri);
    assert.strictEqual(res.targets.length, 1);
    const t = res.targets[0];
    assert.deepStrictEqual(t.codeLanguages, []);
    assert.deepStrictEqual(t.codeDirs, []);
    assert.deepStrictEqual(t.l10nDirs, []);
    assert.strictEqual(t.l10nExtension, ".po");
    assert.ok(res.messages.some((m) => m.includes("Invalid target definition")));
  });

  test("normalizeSettingsObject validates codeLanguages/l10nFormat/l10nExtension and trims l10nFuncNames", async () => {
    const uri = URI.file("/w/localize-support.json");
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);

    const rawTargets = [
      {
        codeLanguages: ["badlang" as any, "javascript"],
        codeDirs: ["./src"],
        l10nDirs: ["./locale"],
        l10nFuncNames: [" fn ", "fn", ""],
        l10nFormat: "badformat",
        l10nExtension: "po",
      },
    ];

    const res = await svc.normalizeSettingsObject(rawTargets, uri);
    const t = res.targets[0];
    // badlang rejected, javascript accepted
    assert.ok(t.codeLanguages.includes("javascript"));
      assert.ok(!t.codeLanguages.includes("badlang" as any));
    // l10nFuncNames trimmed and deduped
    assert.deepStrictEqual(t.l10nFuncNames, ["fn"]);
    // defaults applied for bad format and extension
    assert.strictEqual(t.l10nFormat, "po");
    assert.strictEqual(t.l10nExtension, ".po");
    assert.ok(res.messages.some((m) => m.includes("Invalid code language 'badlang'")));
    assert.ok(res.messages.some((m) => m.includes("Defaulting to 'po'")));
  });

  test("positionInRange is inclusive of start and end", () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } as any;
    const posStart = { line: 1, character: 2 } as any;
    const posEnd = { line: 1, character: 5 } as any;
    const posMid = { line: 1, character: 3 } as any;
    const posBefore = { line: 1, character: 1 } as any;
    const posAfter = { line: 1, character: 6 } as any;

    assert.strictEqual((svc as any).positionInRange(posStart, range), true);
    assert.strictEqual((svc as any).positionInRange(posEnd, range), true);
    assert.strictEqual((svc as any).positionInRange(posMid, range), true);
    assert.strictEqual((svc as any).positionInRange(posBefore, range), false);
    assert.strictEqual((svc as any).positionInRange(posAfter, range), false);
  });

  test("onReloaded listener is invoked and disposable removes it", () => {
    const spy = sinon.spy();
    const disp = svc.onReloaded(spy);

    // emit the private event emitter
    (svc as any).reloadedEmitter.emit("reloaded", svc);
    assert.ok(spy.calledOnce);

    disp.dispose();
    (svc as any).reloadedEmitter.emit("reloaded", svc);
    assert.strictEqual(spy.callCount, 1);
  });

  test("reload() with workspace index initializes L10nTargetManager on success", async () => {
    sinon.stub(workspace, "getWorkspaceFolders").returns([
      { uri: URI.file("d:/ws"), name: "ws", index: 0 },
    ] as any);
    sinon.stub(workspace, "getConfiguration").returns({ get: (_k: string) => [
      { codeLanguages: ["javascript"], codeDirs: ["./src"], l10nDirs: ["./l10n"], l10nFuncNames: ["t"] }
    ] } as any);
    // validate directories used by normalizeSettingsObject
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);

    const initStub = sinon.stub(L10nTargetManager.prototype, "init").resolves();

    await svc.reload(0);

    const key = workspace.getWorkspaceFolders()![0].uri.path;
    assert.ok((svc as any).managers.has(key));
    assert.ok(initStub.called);
  });

  test("reload() records message when L10nTargetManager.init fails", async () => {
    sinon.stub(workspace, "getWorkspaceFolders").returns([
      { uri: URI.file("d:/ws2"), name: "ws2", index: 0 },
    ] as any);
    sinon.stub(workspace, "getConfiguration").returns({ get: (_k: string) => [
      { codeLanguages: ["javascript"], codeDirs: ["./src"], l10nDirs: ["./l10n"], l10nFuncNames: ["t"] }
    ] } as any);
    // validate directories used by normalizeSettingsObject
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);

    const initStub = sinon.stub(L10nTargetManager.prototype, "init").rejects(new Error("init fail"));

    await svc.reload(0);

    const key = workspace.getWorkspaceFolders()![0].uri.path;
    const diag = (svc as any).settingDiags.get(key);
    assert.ok(diag && (diag as any).type === "status");
    assert.ok((diag as any).messages.some((m: string) => m.includes("Failed to initialize target manager")));
    assert.ok(initStub.called);
  });

  test("dispose() disposes watchers, managers and clears diagnostics", async () => {
    const watcher = { dispose: sinon.spy() } as any;
    (svc as any).settingsWatchers.push(watcher);

    const mgrSpy = { dispose: sinon.spy() } as any;
    const ld = { dispose: sinon.spy() } as any;
    (svc as any).managers.set("/a", [{ manager: mgrSpy, listenerDisposable: ld }]);
    (svc as any).settingDiags.set("/a", { type: "status", messages: ["x"] } as any);

    (svc as any).reloadIntervalQueue.dispose = sinon.spy();

    await svc.dispose();

    assert.ok(watcher.dispose.calledOnce);
    assert.ok(mgrSpy.dispose.calledOnce);
    assert.ok(ld.dispose.calledOnce);
    assert.strictEqual((svc as any).settingDiags.size, 0);
    assert.strictEqual((svc as any).managers.size, 0);
    assert.ok((svc as any).reloadIntervalQueue.dispose.calledOnce);
  });
});
