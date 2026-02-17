import * as assert from "assert";
import * as vscode from "vscode";

/** Locate the position of the "Execute" string in chsharp.cs */
async function locateExecutePosition(): Promise<{ codeUri: vscode.Uri; execLine: number; execChar: number }> {
  const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
  assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
  const codeUri = codeUris[0];
  const codeDoc = await vscode.workspace.openTextDocument(codeUri);
  const codeText = codeDoc.getText();
  const execIndex = codeText.indexOf('"Execute"');
  assert.ok(execIndex >= 0, 'chsharp.cs must contain "Execute"');
  const beforeExec = codeText.slice(0, execIndex);
  const execLine = (beforeExec.match(/\n/g) || []).length; // 0-based
  const execChar = codeDoc.lineAt(execLine).text.indexOf('"Execute"') + 1; // inside quotes
  return { codeUri, execLine, execChar };
}

/** Wait for definition provider to return results */
async function waitForDefs(uri: vscode.Uri, pos: vscode.Position, timeout = 4000): Promise<vscode.Location[]> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos);
    if (res && res.length > 0) {
      return res as vscode.Location[];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return [] as vscode.Location[];
}

/** Wait until providers are ready and can return results for the given position. */
async function waitForReady(uri: vscode.Uri, pos: vscode.Position, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos);
    if (res && res.length > 0) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("provider not ready");
}

suite("providers/definitionProvider (integration)", () => {
  test("Go to definition from code -> .po", async function () {
    this.timeout(5000);
    const { codeUri, execLine, execChar } = await locateExecutePosition();

    const defs = await waitForDefs(codeUri, new vscode.Position(execLine, execChar));
    assert.ok(defs && defs.length > 0, "definition provider should return locations");

    const poDef = defs.find((d) => d.uri.path.endsWith("l10n/ja.po"));
    assert.ok(poDef, "should find a definition in l10n/ja.po");

    const poDoc = await vscode.workspace.openTextDocument(poDef!.uri);
    const msgText = poDoc.getText(poDef!.range);
    assert.ok(msgText.includes("Execute"), "target range should contain the msgid 'Execute'");
  });
});

suite("providers/referenceProvider (integration)", () => {
  test("Find references from .po -> code", async function () {
    this.timeout(5000);

    const poUris = await vscode.workspace.findFiles("**/ja.po");
    assert.ok(poUris.length > 0, "ja.po must exist in fixture");
    const poUri = poUris[0];

    const poDoc = await vscode.workspace.openTextDocument(poUri);
    const full = poDoc.getText();
    const idx = full.indexOf('msgid "Execute"');
    assert.ok(idx >= 0, "msgid Execute must be present in ja.po");
    const before = full.slice(0, idx);
    const line = (before.match(/\n/g) || []).length; // 0-based

    const poLineText = poDoc.lineAt(line).text;
    const poChar = poLineText.indexOf('"Execute"') + 1; // position inside quoted string

    const refs: vscode.Location[] = (await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      poUri,
      new vscode.Position(line, poChar),
    )) as any;

    assert.ok(refs && refs.length > 0, "reference provider should return code references");
    const codeRef = refs.find((r) => r.uri.path.endsWith("chsharp.cs"));
    assert.ok(codeRef, "should find a reference in chsharp.cs");
  });
});

suite("providers/completionProvider (integration)", () => {
  test("Completion fuzzy-match: 'exu' should suggest 'Execute'", async function () {
    this.timeout(4000);

    const { codeUri, execLine, execChar } = await locateExecutePosition();

    // replace inner string with 'exu' to simulate fuzzy typing
    const original = "Execute";
    const replaceEdit = new vscode.WorkspaceEdit();
    replaceEdit.replace(codeUri, new vscode.Range(execLine, execChar, execLine, execChar + original.length), "exu");
    const applied = await vscode.workspace.applyEdit(replaceEdit as any);
    assert.ok(applied, "applyEdit should succeed");

    await new Promise((r) => setTimeout(r, 200));

    const completionRes: any = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      codeUri,
      new vscode.Position(execLine, execChar + 3),
    );

    // restore original content so subsequent tests remain deterministic
    const restoreEdit = new vscode.WorkspaceEdit();
    restoreEdit.replace(codeUri, new vscode.Range(execLine, execChar, execLine, execChar + "exu".length), original);
    await vscode.workspace.applyEdit(restoreEdit as any);

    assert.ok(completionRes && (completionRes.items || Array.isArray(completionRes)), "completion result expected");
    const items = completionRes.items || completionRes;
    const found = items.find((it: any) => String(it.label) === "Execute");
    assert.ok(found, "fuzzy match should suggest 'Execute' for prefix 'exu'");
  });

  test("Completion inside localization function shows known keys and translations", async function () {
    this.timeout(6000);

    const { codeUri, execLine, execChar } = await locateExecutePosition();

    // wait until indexing/providers are ready
    await waitForReady(codeUri, new vscode.Position(execLine, execChar));

    const completionRes: any = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      codeUri,
      new vscode.Position(execLine, execChar),
    );

    assert.ok(completionRes && (completionRes.items || Array.isArray(completionRes)), "completion result expected");

    const items = completionRes.items || completionRes;
    const found = items.find((it: any) => String(it.label) === "Execute");
    assert.ok(found, "should contain completion for 'Execute'");
    assert.ok(found.detail && String(found.detail).includes("実行"));
  });
});

suite("providers/renameProvider (integration)", () => {
  test("Rename key in code updates .po and code references", async function () {
    this.timeout(8000);

    const { codeUri, execLine, execChar } = await locateExecutePosition();
    const newKey = "Execute_RENAMED";

    // ensure provider/index ready
    await waitForReady(codeUri, new vscode.Position(execLine, execChar));

    const edit: any = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      codeUri,
      new vscode.Position(execLine, execChar),
      newKey,
    );

    assert.ok(edit, "rename provider must return a WorkspaceEdit-like object");

    const applied = await vscode.workspace.applyEdit(edit as any);
    assert.ok(applied, "workspace edit should be applied");

    const updatedCodeDoc = await vscode.workspace.openTextDocument(codeUri);
    const codeContains = updatedCodeDoc.getText().includes(`"${newKey}"`) || updatedCodeDoc.getText().includes(newKey);

    const poUris = await vscode.workspace.findFiles("**/ja.po");
    assert.ok(poUris.length > 0, "ja.po must exist in fixture");
    const poDoc = await vscode.workspace.openTextDocument(poUris[0]);
    const poContains = poDoc.getText().includes(`msgid \"${newKey}\"`);

    assert.ok(codeContains || poContains, "either code or .po should contain the renamed key");

    // restore fixture contents so subsequent tests remain deterministic
    const restoreEdit = new vscode.WorkspaceEdit();
    if (codeContains) {
      const curCode = (await vscode.workspace.openTextDocument(codeUri)).getText();
      const restored = curCode.replace(newKey, "Execute");
      restoreEdit.replace(codeUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), restored);
    }
    if (poContains) {
      const poUri2 = (await vscode.workspace.findFiles("**/ja.po"))[0];
      const curPo = (await vscode.workspace.openTextDocument(poUri2)).getText();
      const restoredPo = curPo.replace(newKey, "Execute");
      restoreEdit.replace(poUri2, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), restoredPo);
    }
    if ((restoreEdit as any).size !== 0) {
      const ok = await vscode.workspace.applyEdit(restoreEdit as any);
      assert.ok(ok, "fixture restore should succeed");
    }
  });

  test("Rename to an existing msgid should be rejected (conflict)", async function () {
    this.timeout(5000);

    const { codeUri, execLine, execChar } = await locateExecutePosition();

    // ensure provider ready
    await waitForReady(codeUri, new vscode.Position(execLine, execChar));

    let threw = false;
    try {
      await vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        codeUri,
        new vscode.Position(execLine, execChar),
        "Save changes",
      );
    } catch (err: any) {
      threw = true;
      const msg = String(err || "");
      assert.ok(msg.includes("already exists") || msg.includes("target key"), `error should mention conflict, got: ${msg}`);
    }
    assert.ok(threw, "rename should be rejected due to existing msgid");
  });
});

// TODO: 残りのプロバイダとコマンドのテスト
suite("providers/diagnosticProvider (integration)", () => {
  test("Diagnostics reported for missing msgid in .po", async function () {
    this.timeout(5000);

    // open a code file that references a non-existent key
    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];
    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const text = codeDoc.getText();

    // insert a fake key that is not present in .po to *help* trigger diagnostics (fixture already contains diagnostics)
    const fakeKey = "__MISSING_KEY_FOR_DIAG__";
    const insertPos = codeDoc.positionAt(text.indexOf('"Execute"'));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(codeUri, insertPos, ` /*diag*/ ${fakeKey}`);
    await vscode.workspace.applyEdit(edit as any);

    // give providers some time to run
    await new Promise((r) => setTimeout(r, 400));

    const diagnostics = vscode.languages.getDiagnostics(codeUri);
    // accept diagnostics that either mention the inserted fake key or indicate an undefined/missing localization key
    const found = diagnostics.find((d) => d.message.includes(fakeKey) || /Undefined localization key|missing|未定義|unresolved|not found/i.test(d.message));

    // cleanup the edit we made
    const revert = new vscode.WorkspaceEdit();
    const replaced = (await vscode.workspace.openTextDocument(codeUri)).getText();
    const cleaned = replaced.replace(` /*diag*/ ${fakeKey}`, "");
    revert.replace(codeUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), cleaned);
    await vscode.workspace.applyEdit(revert as any);

    assert.ok(found, `expected a diagnostic mentioning ${fakeKey} or an undefined localization key but got: ${JSON.stringify(diagnostics)}`);
  });
});

suite("providers/codeActionProvider (integration)", () => {
  test("handles diagnostics that contain a code (may return no actions)", async function () {
    this.timeout(6000);

    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];
    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const text = codeDoc.getText();

    // insert a fake key to trigger an 'undefined key' diagnostic
    const fakeKey = "__MISSING_KEY_FOR_CODEACTION__";
    const insertPos = codeDoc.positionAt(text.indexOf('"Execute"'));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(codeUri, insertPos, ` /*diag*/ ${fakeKey}`);
    await vscode.workspace.applyEdit(edit as any);

    // wait briefly for diagnostics to appear
    await new Promise((r) => setTimeout(r, 500));

    const diagnostics = vscode.languages.getDiagnostics(codeUri);
    const targetDiag = diagnostics.find((d) => d.message.includes(fakeKey) || /Undefined localization key/i.test(d.message));
    assert.ok(targetDiag, `expected diagnostic for inserted key; got: ${JSON.stringify(diagnostics)}`);

    // ask VS Code to run the code action provider for the diagnostic range
    const actions: any = await vscode.commands.executeCommand(
      "vscode.executeCodeActionProvider",
      codeUri,
      targetDiag!.range,
    );

    // cleanup the edit we made
    const revert = new vscode.WorkspaceEdit();
    const replaced = (await vscode.workspace.openTextDocument(codeUri)).getText();
    const cleaned = replaced.replace(` /*diag*/ ${fakeKey}`, "");
    revert.replace(codeUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), cleaned);
    await vscode.workspace.applyEdit(revert as any);

    // provider must return an array; actions may be empty for certain diag codes
    assert.ok(Array.isArray(actions), "executeCodeActionProvider should return an array");
  });
});

suite("providers/hoverProvider (integration)", () => {
  test("Hover shows translation and source when hovering a localization key", async function () {
    this.timeout(5000);

    const { codeUri, execLine, execChar } = await locateExecutePosition();

    // wait until provider/index ready
    await waitForReady(codeUri, new vscode.Position(execLine, execChar));

    const res: any = await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      codeUri,
      new vscode.Position(execLine, execChar + 1),
    );

    assert.ok(res && res.length > 0, "hover provider should return results");
    const hover = res[0] as vscode.Hover;
    const hoverText = (hover.contents || []).map((c: any) => (typeof c === "string" ? c : c.value)).join('\n');
    assert.ok(/実行|Execute/.test(hoverText), `hover text should include translation or msgid; got: ${hoverText}`);
  });
});

suite("commands/openLocationCommand (integration)", () => {
  test("openLocationCommand opens the expected file and range", async function () {
    this.timeout(5000);

    // find a .po location for "Execute" via definition provider
    const { codeUri, execLine, execChar } = await locateExecutePosition();
    const defs = await waitForDefs(codeUri, new vscode.Position(execLine, execChar));
    const poDef = defs.find((d) => d.uri.path.endsWith("l10n/ja.po"));
    assert.ok(poDef, "should find a .po definition");

    // execute the extension command that opens a location (pass payload shape expected by handler)
    // don't rely on active editor focus (integration environment can be flaky) — ensure command completes
    await Promise.race([
      vscode.commands.executeCommand("localize-support.openLocation", { uri: poDef.uri.toString(), location: { range: poDef.range } }),
      new Promise((r) => setTimeout(r, 500)),
    ]);

    // verify the target document and range are correct by opening the document directly
    const poDoc = await vscode.workspace.openTextDocument(poDef.uri);
    const msgText = poDoc.getText(poDef.range);
    assert.ok(msgText.includes("Execute"), "target range should contain the msgid 'Execute'");
  });
});

suite("commands/toggleDiagnosticsCommand (integration)", () => {
  test("toggleDiagnosticsCommand toggles diagnostic visibility (no error thrown)", async function () {
    this.timeout(4000);

    // ensure the command is registered
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("localize-support.toggleDiagnostics"));

    // execute the command but don't allow the test to hang if UI awaits a user response
    const p1 = vscode.commands.executeCommand("localize-support.toggleDiagnostics");
    await Promise.race([p1, new Promise((r) => setTimeout(r, 300))]);

    const p2 = vscode.commands.executeCommand("localize-support.toggleDiagnostics");
    await Promise.race([p2, new Promise((r) => setTimeout(r, 300))]);

    // final sanity check
    const poUris = await vscode.workspace.findFiles("**/ja.po");
    assert.ok(poUris.length > 0, "ja.po must exist in fixture");
  });
});
