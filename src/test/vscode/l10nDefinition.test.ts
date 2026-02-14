import * as assert from "assert";
import * as vscode from "vscode";

suite("L10n Definition/Reference (integration)", () => {
  test("Go to Definition from code -> .po and Find References from .po -> code", async () => {
    const wsf = vscode.workspace.workspaceFolders?.[0];
    assert.ok(wsf, "workspace folder must be available");

    // open the C# source file
    const codeUris = await vscode.workspace.findFiles("**/chsharp.cs");
    assert.ok(codeUris.length > 0, "chsharp.cs must exist in fixture");
    const codeUri = codeUris[0];

    // request definition at the first localization call 'G("Execute")'
    const defs: vscode.Location[] = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      codeUri,
      new vscode.Position(11, 25), // approximate position inside G("Execute")
    )) as any;

    assert.ok(defs && defs.length > 0, "definition provider should return locations");

    // one of the definitions must point into ja.po
    const poDef = defs.find((d) => d.uri.path.endsWith("l10n/ja.po"));
    assert.ok(poDef, "should find a definition in l10n/ja.po");

    // verify the text at the target range contains the expected msgid
    const poDoc = await vscode.workspace.openTextDocument(poDef!.uri);
    const msgText = poDoc.getText(poDef!.range);
    assert.ok(msgText.includes("msgid \"Execute\""), "target range should contain the msgid 'Execute'");

    // --- references: ask for references from the po msgid location ---
    // locate the msgid line in the po document for 'Execute'
    const allPoUris = await vscode.workspace.findFiles("**/ja.po");
    assert.ok(allPoUris.length > 0, "ja.po must exist in fixture");
    const poUri = allPoUris[0];
    const poDoc2 = await vscode.workspace.openTextDocument(poUri);
    const full = poDoc2.getText();
    const idx = full.indexOf("msgid \"Execute\"");
    assert.ok(idx >= 0, "msgid Execute must be present in ja.po");
    const before = full.slice(0, idx);
    const line = (before.match(/\n/g) || []).length; // 0-based line number

    const refs: vscode.Location[] = (await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      poUri,
      new vscode.Position(line, 2),
    )) as any;

    assert.ok(refs && refs.length > 0, "reference provider should return code references");
    const codeRef = refs.find((r) => r.uri.path.endsWith("chsharp.cs"));
    assert.ok(codeRef, "should find a reference in chsharp.cs");
  });
});
