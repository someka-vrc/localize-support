import '../unit/setup';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { POManager } from '../../services/poManager';
import { computeUnusedPoDiagnostics } from '../../services/poDiagnostics';

suite('PODiagnostics - integration', () => {
  test('detects unused entry and ignores referenced entry', async function () {
    this.timeout(20000);
    let addedWorkspace = false;
    let ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    let tmpRoot: vscode.Uri | undefined;
    if (!ws) {
      // create and add a temporary workspace folder for the test
      const os = require('os');
      const path = require('path');
      tmpRoot = vscode.Uri.file(path.join(os.tmpdir(), `po-dotnet-test-${Date.now()}`));
      await vscode.workspace.fs.createDirectory(tmpRoot);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: tmpRoot, name: 'po-dotnet-test' });
      addedWorkspace = true;
      ws = vscode.workspace.getWorkspaceFolder(tmpRoot)!;
    }
    const root = ws!.uri.fsPath;
    const tmpDir = vscode.Uri.file(require('path').join(root, 'test-fixtures-podiag'));

    // cleanup if exists
    try { await vscode.workspace.fs.delete(tmpDir, { recursive: true }); } catch (_) {}
    await vscode.workspace.fs.createDirectory(tmpDir);

    // create config
    const cfgDir = vscode.Uri.file(require('path').join(tmpDir.fsPath, 'proj'));
    await vscode.workspace.fs.createDirectory(cfgDir);
    const srcDir = vscode.Uri.file(require('path').join(cfgDir.fsPath, 'src'));
    const poDir = vscode.Uri.file(require('path').join(cfgDir.fsPath, 'L10N'));
    await vscode.workspace.fs.createDirectory(srcDir);
    await vscode.workspace.fs.createDirectory(poDir);

    const cfg = {
      config: [
        { sourceDirs: ['./src'], poDirs: ['./L10N'], localizeFuncs: ['G'] }
      ]
    };
    await vscode.workspace.fs.writeFile(vscode.Uri.file(require('path').join(cfgDir.fsPath, 'podotnetconfig.json')), Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));

    // create source file that references msgid 'hello'
    const srcFile = vscode.Uri.file(require('path').join(srcDir.fsPath, 'file.cs'));
    const srcContent = 'class A { void M() { var s = G("hello"); } }\n';
    await vscode.workspace.fs.writeFile(srcFile, Buffer.from(srcContent, 'utf8'));

    // create po file with two entries: hello (referenced) and unused (not referenced)
    const poFile = vscode.Uri.file(require('path').join(poDir.fsPath, 'messages.po'));
    const poContent = `msgid ""
msgstr ""

msgid "hello"
msgstr "こんにちは"

msgid "unused"
msgstr "unused translation"
`;
    await vscode.workspace.fs.writeFile(poFile, Buffer.from(poContent, 'utf8'));

    // instantiate POManager
    const fakeContext: any = { subscriptions: [] };
    const poManager = new POManager(fakeContext);

    // ensure PO dirs are scanned
    const wsFolder = ws;
    await poManager.ensureDirs([poDir.fsPath], wsFolder);

    // wait until POManager has loaded the msgids we expect
    const waitForMsgids = async (expected: string[], timeout = 4000) => {
      const start = Date.now();
      while (true) {
        const ids = poManager.getAllMsgids([poDir.fsPath]);
        const ok = expected.every((e) => (ids as Set<string>).has(e));
        if (ok) return;
        if (Date.now() - start > timeout) throw new Error('timeout waiting for PO msgids');
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await waitForMsgids(['hello', 'unused']);

    // Ensure the extension scanner has completed before computing diagnostics
    try { const ok = await vscode.commands.executeCommand('po-dotnet.waitForScanIdle', 5000); if (!ok) { await new Promise(r => setTimeout(r, 200)); } } catch (_) { await new Promise(r => setTimeout(r, 200)); }

    // open source doc and build simple refResolver that checks for occurrences in source
    const srcDoc = await vscode.workspace.openTextDocument(srcFile);
    const txt = srcDoc.getText();
    const refMap = new Map<string, Array<{ uri: vscode.Uri; range: vscode.Range }>>();
    const re = /G\(\"([^\"]+)\"\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const msgid = m[1];
      const start = srcDoc.positionAt(m.index + m[0].indexOf('"') + 1);
      const end = srcDoc.positionAt(m.index + m[0].lastIndexOf('"'));
      const range = new vscode.Range(start, end);
      const arr = refMap.get(msgid) || [];
      arr.push({ uri: srcFile, range });
      refMap.set(msgid, arr);
    }
    const refResolver = (msgid: string) => refMap.get(msgid) || [];

    // prepare cfgsByWorkspace
    const cfgsByWorkspace = new Map<string, any[]>();
    cfgsByWorkspace.set(wsFolder.uri.toString(), [{ sourceDirs: [srcDir.fsPath], poDirs: [poDir.fsPath], localizeFuncs: ['G'], workspaceFolder: wsFolder }]);

    const diags = vscode.languages.createDiagnosticCollection('po-dotnet-test');
    try {
      // Debug info to help detect why diagnostics might be missing
      console.log('DEBUG: PO msgids:', Array.from(poManager.getAllMsgids([poDir.fsPath])));
      console.log('DEBUG: PO file URIs:', poManager.getPOFileUris([poDir.fsPath]));
      console.log('DEBUG: Entry status for "unused":', poManager.getEntryStatus('unused', [poDir.fsPath]));

      const start = Date.now();
      let foundUnused = false;
      while (true) {
        await computeUnusedPoDiagnostics(poManager, diags, cfgsByWorkspace, refResolver);
        const diagsForPo = diags.get(poFile) || [];
        const messages = diagsForPo.map(d => d.message);
        foundUnused = messages.some(m => m.includes("Unused PO entry") && m.includes('unused'));
        if (foundUnused) break;
        if (Date.now() - start > 15000) break;
        try { await vscode.commands.executeCommand('po-dotnet.waitForScanIdle', 1000); } catch (_) {}
        await new Promise((r) => setTimeout(r, 100));
      }

      const diagsForPo = diags.get(poFile) || [];
      console.log('DEBUG: final diagsForPo:', diagsForPo);
      // should contain one diagnostic for 'unused' but not for 'hello'
      const messages = diagsForPo.map(d => d.message);
      const hasUnused = messages.some(m => m.includes("Unused PO entry") && m.includes('unused'));
      const hasHello = messages.some(m => m.includes('hello'));
      assert.ok(hasUnused, 'Missing diagnostics for unused entry');
      assert.ok(!hasHello, 'Found diagnostic for referenced entry');
    } finally {
      diags.dispose();
      // cleanup
      try { await vscode.workspace.fs.delete(tmpDir, { recursive: true }); } catch (_) {}
      if (addedWorkspace && tmpRoot) {
        // remove the workspace folder we added
        vscode.workspace.updateWorkspaceFolders(0, 1);
        try { await vscode.workspace.fs.delete(tmpRoot, { recursive: true }); } catch (_) {}
      }
    }
  });
});