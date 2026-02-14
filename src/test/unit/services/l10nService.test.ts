import * as assert from "assert";
import sinon from "sinon";
import { URI } from "vscode-uri";
import { MockWorkspaceService } from "../mocks/mockWorkspaceService";
import { L10nService } from "../../../services/l10nService";
import { L10nTargetManager } from "../../../services/l10nTargetManager";
import { vscTypeHelper } from "../../../models/vscTypes";

suite("L10nService (unit)", () => {
  let workspace: MockWorkspaceService;
  let svc: L10nService;

  setup(() => {
    workspace = new MockWorkspaceService();
    svc = new L10nService(workspace as any, 10);
  });

  teardown(() => {
    sinon.restore();
  });

  test("reload() records diagnostic when readFile throws (unit)", async () => {
    const uri = URI.file("/path/to/localize-support.json");
    sinon.stub(workspace, "readFile").rejects(new Error("read-failure"));

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
    sinon.stub(workspace, "validateDirectoryPath").callsFake(async (uri: URI) => {
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
    // debug output for normalized dirs
    console.debug(
      "normalized codeDirs:",
      t.codeDirs.map((d) => d.path),
    );
    // only the existing code dir should be normalized
    assert.strictEqual(t.codeDirs.length, 1);
    assert.ok(t.codeDirs[0].path.endsWith("/src/exists"));
    // debug output for normalized l10n dirs
    console.debug(
      "normalized l10nDirs:",
      t.l10nDirs.map((d) => d.path),
    );
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

    const mgr = new L10nTargetManager(workspace as any, target, 1);

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

    const mgr = new L10nTargetManager(workspace as any, target, 1);

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

    const mgr = new L10nTargetManager(workspace as any, target, 1);

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
});
