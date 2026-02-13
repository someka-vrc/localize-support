import assert from "assert";
import { URI } from "vscode-uri";
import { MockWorkspaceService } from "../mocks/mockWorkspaceService";
import { L10nTargetManager } from "../../../services/l10nTargetManager";
import { L10nTarget } from "../../../models/l10nTypes";
import { vscTypeHelper, MyDiagnosticSeverity } from "../../../models/vscTypes";

suite("L10nTargetManager diagnostics (unit)", () => {
  let workspace: MockWorkspaceService;
  const baseTarget: L10nTarget = {
    codeLanguages: ["javascript" as any],
    codeDirs: [URI.file("d:/proj/src")],
    l10nFormat: "po",
    l10nDirs: [URI.file("d:/proj/locales")],
    l10nExtension: ".po",
    l10nFuncNames: ["t"],
    settingsLocation: URI.file("d:/proj"),
  };

  setup(() => {
    workspace = new MockWorkspaceService();
  });

  test("undefined key used in code -> warning on code URI", () => {
    const mgr = new L10nTargetManager(workspace, baseTarget, 1);
    const codeUri = URI.file("d:/proj/src/foo.js");

    // simulate code uses key 'missing.key'
    mgr.codes.set(codeUri.path, [
      {
        key: "missing.key",
        location: vscTypeHelper.newLocation(codeUri, vscTypeHelper.newRange(1, 2, 1, 20)),
      },
    ] as any);

    // no translations present
    const items = mgr.getMatchDiagnostics();
    const forCode = items.find((it) => it.uri.path === codeUri.path)?.diagnostics || [];
    assert.ok(forCode.some((d) => /missing.key/.test(d.message) && d.severity === MyDiagnosticSeverity.Warning));
  });

  test("unused translation entry -> information on l10n URI", () => {
    const mgr = new L10nTargetManager(workspace, baseTarget, 1);
    const luri = URI.file("d:/proj/locales/ja.po");

    // simulate translation file with key 'unused.key'
    mgr.l10ns.set(luri.path, {
      success: true,
      diagnostics: [],
      entries: {
        ja: {
          "unused.key": {
            translation: "",
            location: vscTypeHelper.newLocation(luri, vscTypeHelper.newRange(2, 0, 2, 10)),
          },
        },
      },
    } as any);

    // no code references
    const items = mgr.getMatchDiagnostics();
    const forL10n = items.find((it) => it.uri.path === luri.path)?.diagnostics || [];
    assert.ok(forL10n.some((d) => /unused.key/.test(d.message) && d.severity === MyDiagnosticSeverity.Information));
  });

  test("missing translation in other language -> warning on that language file", () => {
    const mgr = new L10nTargetManager(workspace, baseTarget, 1);
    const en = URI.file("d:/proj/locales/en.po");
    const ja = URI.file("d:/proj/locales/ja.po");

    // en has key 'hello', ja missing
    mgr.l10ns.set(en.path, {
      success: true,
      diagnostics: [],
      entries: {
        en: {
          hello: {
            translation: "hello",
            location: vscTypeHelper.newLocation(en, vscTypeHelper.newRange(1, 0, 1, 10)),
          },
        },
      },
    } as any);

    // ja exists but without 'hello'
    mgr.l10ns.set(ja.path, {
      success: true,
      diagnostics: [],
      entries: {
        ja: {},
      },
    } as any);

    const items = mgr.getMatchDiagnostics();
    const forJa = items.find((it) => it.uri.path === ja.path)?.diagnostics || [];
    assert.ok(
      forJa.some(
        (d) => /Missing translation for key 'hello'/.test(d.message) && d.severity === MyDiagnosticSeverity.Warning,
      ),
    );
  });

  test("integration: code uses key present in one lang -> no undefined; missing lang diagnostic emitted", () => {
    const mgr = new L10nTargetManager(workspace, baseTarget, 1);
    const codeUri = URI.file("d:/proj/src/app.js");
    const en = URI.file("d:/proj/locales/en.po");
    const ja = URI.file("d:/proj/locales/ja.po");

    // code uses 'greet'
    mgr.codes.set(codeUri.path, [
      { key: "greet", location: vscTypeHelper.newLocation(codeUri, vscTypeHelper.newRange(0, 0, 0, 10)) },
    ] as any);

    // en has 'greet'
    mgr.l10ns.set(en.path, {
      success: true,
      diagnostics: [],
      entries: {
        en: {
          greet: { translation: "hi", location: vscTypeHelper.newLocation(en, vscTypeHelper.newRange(1, 0, 1, 5)) },
        },
      },
    } as any);

    // ja missing greet but has unused 'onlyInJa'
    mgr.l10ns.set(ja.path, {
      success: true,
      diagnostics: [],
      entries: {
        ja: {
          onlyInJa: { translation: "x", location: vscTypeHelper.newLocation(ja, vscTypeHelper.newRange(2, 0, 2, 4)) },
        },
      },
    } as any);

    const items = mgr.getMatchDiagnostics();

    // code should NOT have undefined diag for 'greet'
    const codeDiags = items.find((it) => it.uri.path === codeUri.path)?.diagnostics || [];
    assert.ok(!codeDiags.some((d) => /greet/.test(d.message) && d.severity === MyDiagnosticSeverity.Warning));

    // ja should have missing translation for 'greet'
    const jaDiags = items.find((it) => it.uri.path === ja.path)?.diagnostics || [];
    assert.ok(jaDiags.some((d) => /Missing translation for key 'greet'/.test(d.message)));

    // ja should also have unused entry diagnostic for 'onlyInJa'
    assert.ok(jaDiags.some((d) => /onlyInJa/.test(d.message) && d.severity === MyDiagnosticSeverity.Information));
  });
});
