import '../unit/setup';
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Definition provider - integration', () => {
  test('go to definition from C# to PO entry', async function () {
    this.timeout(120000);
    this.retries(2);

    let addedWorkspace = false;
    let ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    let tmpRoot: vscode.Uri | undefined;
    if (!ws) {
      const os = require('os');
      tmpRoot = vscode.Uri.file(require('path').join(os.tmpdir(), `po-support-def-${Date.now()}`));
      await vscode.workspace.fs.createDirectory(tmpRoot);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: tmpRoot, name: 'po-support-def' });
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
    try { await vscode.commands.executeCommand('po-support.reloadData'); } catch (_) {}
    try { const ok = await vscode.commands.executeCommand('po-support.waitForScanIdle', 10000); if (!ok) { await new Promise(r => setTimeout(r, 500)); } } catch (_) { await new Promise(r => setTimeout(r, 500)); }

    const doc = await vscode.workspace.openTextDocument(srcFile);
    const txt = doc.getText();
    const idx = txt.indexOf('hello');
    assert.ok(idx >= 0, 'Could not find hello in source');
    const pos = doc.positionAt(idx + 1);

    // retry loop to allow scanner/providers to register and populate data
    const start = Date.now();
    let found = false;
    let defs: vscode.Location[] | vscode.LocationLink[] | undefined;
    while (true) {
      try {
        const res = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', srcFile, pos) as any;
        defs = res;
        if (res && res.length > 0) {
          // check for any location pointing to our messages.po
          const anyPo = res.some((d: any) => (d.targetUri ? d.targetUri : d.uri).fsPath && ((d.targetUri ? d.targetUri : d.uri).fsPath.endsWith('messages.po')));
          if (anyPo) {
            found = true;
            break;
          }
        }
      } catch (e) {
        // ignore and retry
      }
      if (Date.now() - start > 15000) break;
      try { await vscode.commands.executeCommand('po-support.waitForScanIdle', 1000); } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }

    assert.ok(found, 'Definition provider did not return a PO location');

    // verify the referenced line in PO contains msgid "hello"
    const foundDef = (defs as any).find((d: any) => ((d.targetUri ? d.targetUri : d.uri).fsPath.endsWith('messages.po')));
    const targetUri = (foundDef.targetUri ? foundDef.targetUri : foundDef.uri) as vscode.Uri;
    const targetRange = foundDef.targetRange || foundDef.range || undefined;
    const poDoc = await vscode.workspace.openTextDocument(targetUri);
    const lineNum = targetRange ? targetRange.start.line : 0;
    const lineText = poDoc.lineAt(lineNum).text;
    assert.ok(lineText.includes('msgid "hello"'), 'Target PO line did not contain expected msgid');

    // cleanup
    try { await vscode.workspace.fs.delete(baseDir, { recursive: true }); } catch (_) {}
    if (addedWorkspace && tmpRoot) {
      vscode.workspace.updateWorkspaceFolders(0, 1);
      try { await vscode.workspace.fs.delete(tmpRoot, { recursive: true }); } catch (_) {}
    }
  });
});
