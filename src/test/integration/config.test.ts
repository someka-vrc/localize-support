import '../setup';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { collectAllConfigsInWorkspace } from '../../config';
import * as path from 'path';

suite('Config - collectAllConfigsInWorkspace (integration)', () => {
  test('finds podotnetconfig.json files and resolves paths', async () => {
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    assert.ok(ws, 'Workspace required for this test');
    const root = ws!.uri.fsPath;
    const tmpDir = vscode.Uri.file(path.join(root, 'test-fixtures-config'));

    // cleanup
    try { await vscode.workspace.fs.delete(tmpDir, { recursive: true }); } catch (_) {}
    await vscode.workspace.fs.createDirectory(tmpDir);

    // create two config files in nested dirs
    const dirA = vscode.Uri.file(path.join(tmpDir.fsPath, 'a'));
    const dirB = vscode.Uri.file(path.join(tmpDir.fsPath, 'sub', 'b'));
    await vscode.workspace.fs.createDirectory(dirA);
    await vscode.workspace.fs.createDirectory(dirB);

    const cfgA = { sourceDirs: ['srcA'], poDirs: ['L10NA'], localizeFuncs: ['G'] };
    const cfgB = { sourceDirs: ['srcB'], poDirs: ['L10NB'], localizeFuncs: ['G2'] };

    await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(dirA.fsPath, 'podotnetconfig.json')), Buffer.from(JSON.stringify(cfgA, null, 2), 'utf8'));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(dirB.fsPath, 'podotnetconfig.json')), Buffer.from(JSON.stringify(cfgB, null, 2), 'utf8'));

    // run collector
    const map = await collectAllConfigsInWorkspace();
    // should include an entry for this workspace
    const key = ws!.uri.toString();
    assert.ok(map.has(key), 'Workspace key not present in config map');
    const arr = map.get(key)!;
    // there should be at least two configs collected
    assert.ok(arr.length >= 2, 'Expected at least 2 config objects');

    // Check that resolved paths are absolute and include our temp dirs
    const allSourceDirs = arr.flatMap((c) => c.sourceDirs);
    const foundA = allSourceDirs.some((s) => s.includes('test-fixtures-config') && s.includes('a'));
    const foundB = allSourceDirs.some((s) => s.includes('test-fixtures-config') && s.includes('sub') && s.includes('b'));
    assert.ok(foundA, 'Did not find resolved source dir for A');
    assert.ok(foundB, 'Did not find resolved source dir for B');

    // cleanup
    try { await vscode.workspace.fs.delete(tmpDir, { recursive: true }); } catch (_) {}
  });
});