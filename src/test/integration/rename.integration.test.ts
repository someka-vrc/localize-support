import '../setup';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Rename provider - integration', () => {
  test('renaming in source updates PO and renaming in PO updates source', async () => {
    let addedWorkspace = false;
    let ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    let tmpRoot: vscode.Uri | undefined;
    if (!ws) {
      const os = require('os');
      tmpRoot = vscode.Uri.file(path.join(os.tmpdir(), `po-dotnet-rename-${Date.now()}`));
      await vscode.workspace.fs.createDirectory(tmpRoot);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: tmpRoot, name: 'po-dotnet-rename' });
      addedWorkspace = true;
      ws = vscode.workspace.getWorkspaceFolder(tmpRoot)!;
    }

    const root = ws!.uri.fsPath;
    const baseDir = vscode.Uri.file(path.join(root, 'proj'));
    const srcDir = vscode.Uri.file(path.join(baseDir.fsPath, 'src'));
    const poDir = vscode.Uri.file(path.join(baseDir.fsPath, 'L10N'));

    // cleanup
    try { await vscode.workspace.fs.delete(baseDir, { recursive: true }); } catch (_) {}
    await vscode.workspace.fs.createDirectory(srcDir);
    await vscode.workspace.fs.createDirectory(poDir);

    const cfg = {
      config: [
        { sourceDirs: ['./src'], poDirs: ['./L10N'], localizeFuncs: ['G'] }
      ]
    };
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(baseDir.fsPath, 'podotnetconfig.json')), Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));

    // create source and po
    const srcFile = vscode.Uri.file(path.join(srcDir.fsPath, 'file.cs'));
    const srcContent = 'class A { void M() { var s = G("hello"); } }\n';
    await vscode.workspace.fs.writeFile(srcFile, Buffer.from(srcContent, 'utf8'));

    const poFile = vscode.Uri.file(path.join(poDir.fsPath, 'messages.po'));
    const poContent = `msgid ""
msgstr ""

msgid "hello"
msgstr "こんにちは"
`;
    await vscode.workspace.fs.writeFile(poFile, Buffer.from(poContent, 'utf8'));

    // Trigger a reload to ensure the checker scans files
    try { await vscode.commands.executeCommand('po-dotnet.reloadData'); } catch (_) {}

    // Rename from source: 'hello' -> 'hola'
    const srcDoc = await vscode.workspace.openTextDocument(srcFile);
    const srcTxt = srcDoc.getText();
    const helloOffset = srcTxt.indexOf('hello');
    assert.ok(helloOffset >= 0, 'Could not find hello in source');
    const srcPos = srcDoc.positionAt(helloOffset + 1);

    const renameEdit: any = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', srcFile, srcPos, 'hola');
    assert.ok(renameEdit, 'Rename provider returned no edit');
    const applied = await vscode.workspace.applyEdit(renameEdit);
    assert.ok(applied, 'Failed to apply rename edit from source');

    // Verify PO updated
    const updatedPo = await vscode.workspace.openTextDocument(poFile);
    const poTxt1 = updatedPo.getText();
    assert.ok(poTxt1.includes('msgid "hola"'), 'PO file was not updated with new msgid from source rename');

    // Now rename from PO: 'hola' -> 'salut'
    const poPosOffset = poTxt1.indexOf('msgid "hola"');
    assert.ok(poPosOffset >= 0, 'Could not find hola in PO file');
    const poPos = updatedPo.positionAt(poPosOffset + ('msgid "'.length));

    const renameEdit2: any = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', poFile, poPos, 'salut');
    assert.ok(renameEdit2, 'Rename provider returned no edit for PO');
    const applied2 = await vscode.workspace.applyEdit(renameEdit2);
    assert.ok(applied2, 'Failed to apply rename edit from PO');

    // Verify source updated
    const updatedSrc = await vscode.workspace.openTextDocument(srcFile);
    const srcTxt2 = updatedSrc.getText();
    assert.ok(srcTxt2.includes('G("salut")'), 'Source was not updated after PO rename');

    // cleanup
    try { await vscode.workspace.fs.delete(baseDir, { recursive: true }); } catch (_) {}
    if (addedWorkspace && tmpRoot) {
      vscode.workspace.updateWorkspaceFolders(0, 1);
      try { await vscode.workspace.fs.delete(tmpRoot, { recursive: true }); } catch (_) {}
    }
  });
});