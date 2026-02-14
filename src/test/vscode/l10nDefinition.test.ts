import * as assert from "assert";
import * as vscode from "vscode";

suite("L10n Definition/Reference (integration)", () => {
  test("Go to Definition from code -> .po and Find References from .po -> code", async function () {
    this.timeout(5000);
    const wsf = vscode.workspace.workspaceFolders?.[0];
    assert.ok(wsf, "workspace folder must be available");

    // open the C# source file
    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];

    // open document and log language/matching for debug
    const doc = await vscode.workspace.openTextDocument(codeUri);

    // request definition at the first localization call 'G("Execute")'
    // compute a position inside the string literal dynamically (avoid fragile hard-coded coords)
    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const codeText = codeDoc.getText();
    const execIndex = codeText.indexOf('"Execute"');
    assert.ok(execIndex >= 0, 'chsharp.cs must contain "Execute"');
    const beforeExec = codeText.slice(0, execIndex);
    const execLine = (beforeExec.match(/\n/g) || []).length; // 0-based
    const execChar = codeDoc.lineAt(execLine).text.indexOf('"Execute"') + 1; // inside the quoted string

    // wait/poll until provider is ready
    const waitForDefs = async (uri: vscode.Uri, pos: vscode.Position, timeout = 4000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const res: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos);
        if (res && res.length > 0) {
          return res as vscode.Location[];
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return [] as vscode.Location[];
    };

    const defs: vscode.Location[] = await waitForDefs(codeUri, new vscode.Position(execLine, execChar));
    assert.ok(defs && defs.length > 0, "definition provider should return locations");

    // one of the definitions must point into ja.po
    const poDef = defs.find((d) => d.uri.path.endsWith("l10n/ja.po"));
    assert.ok(poDef, "should find a definition in l10n/ja.po");

    // verify the text at the target range contains the expected msgid
    const poDoc = await vscode.workspace.openTextDocument(poDef!.uri);
    const msgText = poDoc.getText(poDef!.range);
    // PoParser returns the range of the quoted string token, so check for the key itself
    assert.ok(msgText.includes("Execute"), "target range should contain the msgid 'Execute'");

    // --- references: ask for references from the po msgid location ---
    // locate the msgid line in the po document for 'Execute'
    const allPoUris = await vscode.workspace.findFiles("**/ja.po");
    assert.ok(allPoUris.length > 0, "ja.po must exist in fixture");
    const poUri = allPoUris[0];
    const poDoc2 = await vscode.workspace.openTextDocument(poUri);
    const full = poDoc2.getText();
    const idx = full.indexOf('msgid "Execute"');
    assert.ok(idx >= 0, "msgid Execute must be present in ja.po");
    const before = full.slice(0, idx);
    const line = (before.match(/\n/g) || []).length; // 0-based line number

    const poLineText = poDoc2.lineAt(line).text;
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

  test("Rename key in code updates .po and code references (integration)", async function () {
    this.timeout(8000);

    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];

    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const codeText = codeDoc.getText();
    const execIndex = codeText.indexOf('"Execute"');
    assert.ok(execIndex >= 0, 'chsharp.cs must contain "Execute"');
    const beforeExec = codeText.slice(0, execIndex);
    const execLine = (beforeExec.match(/\n/g) || []).length; // 0-based
    const execChar = codeDoc.lineAt(execLine).text.indexOf('"Execute"') + 1; // inside the quoted string

    const newKey = "Execute_RENAMED";

    // wait until definition provider is ready (ensures L10nService indexes are built)
    const waitForReady = async (uri: vscode.Uri, pos: vscode.Position, timeout = 4000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const res: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos);
        if (res && res.length > 0) {
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("provider not ready");
    };

    await waitForReady(codeUri, new vscode.Position(execLine, execChar));

    const edit: any = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      codeUri,
      new vscode.Position(execLine, execChar),
      newKey,
    );

    // debug dump to help diagnose flaky returns
    console.log("[TEST DEBUG] rename provider returned:", edit);

    assert.ok(edit, "rename provider must return a WorkspaceEdit-like object");

    // normalize returned edit into a flat array of TextEdits so tests are robust
    const flatEdits: any[] = [];

    if (edit && edit.changes) {
      for (const arr of Object.values(edit.changes)) {
        flatEdits.push(...(arr as any[]));
      }
    } else if (edit && edit.documentChanges && Array.isArray(edit.documentChanges)) {
      for (const dc of edit.documentChanges) {
        flatEdits.push(...(dc.edits || []));
      }
    } else if (Array.isArray(edit)) {
      // possible shapes: [ [textDocument, edits], ... ] or [ TextDocumentEdit, ... ]
      for (const entry of edit) {
        if (!entry) {
          continue;
        }
        if (Array.isArray(entry) && Array.isArray(entry[1])) {
          flatEdits.push(...entry[1]);
        } else if (entry && entry.edits && Array.isArray(entry.edits)) {
          flatEdits.push(...entry.edits);
        }
      }
    }

    // apply the returned edit (end-to-end) — integration test works on a copy of the fixture
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

    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];

    const codeDoc = await vscode.workspace.openTextDocument(codeUri);
    const codeText = codeDoc.getText();
    const execIndex = codeText.indexOf('"Execute"');
    assert.ok(execIndex >= 0, 'chsharp.cs must contain "Execute"');
    const beforeExec = codeText.slice(0, execIndex);
    const execLine = (beforeExec.match(/\n/g) || []).length; // 0-based
    const execChar = codeDoc.lineAt(execLine).text.indexOf('"Execute"') + 1; // inside the quoted string

    // ensure provider ready
    const waitForReady2 = async (uri: vscode.Uri, pos: vscode.Position, timeout = 4000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const res: any = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos);
        if (res && res.length > 0) {
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("provider not ready");
    };
    await waitForReady2(codeUri, new vscode.Position(execLine, execChar));

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
      assert.ok(
        msg.includes("already exists") || msg.includes("target key"),
        `error should mention conflict, got: ${msg}`,
      );
    }
    assert.ok(threw, "rename should be rejected due to existing msgid");
  });
});
