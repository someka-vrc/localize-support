import '../unit/setup';
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Reference provider - integration', () => {
  test('find references from PO entry to C# source', async function () {
    this.timeout(120000);
    this.retries(2);

    let addedWorkspace = false;
    let ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    let tmpRoot: vscode.Uri | undefined;
    if (!ws) {
      const os = require('os');
      tmpRoot = vscode.Uri.file(require('path').join(os.tmpdir(), `po-dotnet-ref-${Date.now()}`));
      await vscode.workspace.fs.createDirectory(tmpRoot);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: tmpRoot, name: 'po-dotnet-ref' });
      addedWorkspace = true;
      ws = vscode.workspace.getWorkspaceFolder(tmpRoot)!;
    }

    const root = ws!.uri.fsPath;
    const baseDir = vscode.Uri.file(require('path').join(root, 'proj'));
    const srcDir = vscode.Uri.file(require('path').join(baseDir.fsPath, 'src'));
    const poDir = vscode.Uri.file(require('path').join(baseDir.fsPath, 'L10N'));

    // cleanup
    try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); } catch (_) {}
    try { await vscode.workspace.fs.delete(baseDir, { recursive: true }); } catch (_) {}
    await vscode.workspace.fs.createDirectory(srcDir);
    await vscode.workspace.fs.createDirectory(poDir);

    const cfg = {
      config: [
        { sourceDirs: ['./src'], poDirs: ['./L10N'], localizeFuncs: ['G'] }
      ]
    };
    await vscode.workspace.fs.writeFile(vscode.Uri.file(require('path').join(baseDir.fsPath, 'podotnetconfig.json')), Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));

    const srcFile = vscode.Uri.file(require('path').join(srcDir.fsPath, 'file.cs'));
    const srcContent = 'class A { void M() { var s = G("hello"); } }\n';
    await vscode.workspace.fs.writeFile(srcFile, Buffer.from(srcContent, 'utf8'));

    const poFile = vscode.Uri.file(require('path').join(poDir.fsPath, 'messages.po'));
    const poContent = `msgid ""\nmsgstr ""\n\nmsgid "hello"\nmsgstr "こんにちは"\n`;
    await vscode.workspace.fs.writeFile(poFile, Buffer.from(poContent, 'utf8'));

    // Trigger reload and wait for scanner
    try { await vscode.commands.executeCommand('po-dotnet.reloadData'); } catch (_) {}
    try { const ok = await vscode.commands.executeCommand('po-dotnet.waitForScanIdle', 10000); if (!ok) { await new Promise(r => setTimeout(r, 500)); } } catch (_) { await new Promise(r => setTimeout(r, 500)); }

    const poDoc = await vscode.workspace.openTextDocument(poFile);
    const poTxt = poDoc.getText();
    const idx = poTxt.indexOf('msgid "hello"');
    assert.ok(idx >= 0, 'Could not find msgid "hello" in PO');
    const pos = poDoc.positionAt(idx + ('msgid "'.length));

    const start = Date.now();
    let found = false;
    let refs: vscode.Location[] | undefined;
    while (true) {
      try {
        const res = await vscode.commands.executeCommand('vscode.executeReferenceProvider', poFile, pos) as vscode.Location[];
        refs = res;
        if (res && res.length > 0) {
          const anySrc = res.some((r: any) => r.uri && r.uri.fsPath && r.uri.fsPath.endsWith('file.cs'));
          if (anySrc) {
            found = true;
            break;
          }
        }
      } catch (e) {
        // ignore and retry
      }
      if (Date.now() - start > 15000) break;
      try { await vscode.commands.executeCommand('po-dotnet.waitForScanIdle', 1000); } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }

    assert.ok(found, 'Reference provider did not return a source location for PO entry');

    // verify a reference points to a range containing G("hello")
    const foundRef = (refs as any).find((r: any) => r.uri && r.uri.fsPath && r.uri.fsPath.endsWith('file.cs'));
    const refDoc = await vscode.workspace.openTextDocument(foundRef.uri);
    const refText = refDoc.getText(foundRef.range);
    // Accept a reference that contains the raw msgid or the surrounding call
    assert.ok(/hello/.test(refText), 'Referenced text did not include the expected msgid');

    // cleanup
    try { await vscode.workspace.fs.delete(baseDir, { recursive: true }); } catch (_) {}
    if (addedWorkspace && tmpRoot) {
      vscode.workspace.updateWorkspaceFolders(0, 1);
      try { await vscode.workspace.fs.delete(tmpRoot, { recursive: true }); } catch (_) {}
    }
  });
});
