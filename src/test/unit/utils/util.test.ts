import * as assert from "assert";
import sinon from "sinon";
import { URI, Utils } from "vscode-uri";
import { MockWorkspaceWrapper } from "../mocks/mockVscodeWrapper";
import { normalizeDirPath } from "../../../utils/util";

suite("utils/util (unit)", () => {
  let workspace: MockWorkspaceWrapper;

  setup(() => {
    workspace = new MockWorkspaceWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("returns undefined when relativeFromSettingDir is not a string (unit)", async () => {
    const uri = URI.file("/workspace/localize-support.json");
    const res = await normalizeDirPath(workspace as any, uri, {} as any);
    assert.strictEqual(res, undefined);
  });

  test("returns undefined when workspace folder index is out of range (unit)", async () => {
    sinon.stub(workspace, "getWorkspaceFolders").returns([]);
    const res = await normalizeDirPath(workspace as any, 99);
    assert.strictEqual(res, undefined);
  });

  test("returns dirname URI when file is URI and directory exists (unit)", async () => {
    const fileUri = URI.file("/workspace/proj/config/localize-support.json");
    const settingDir = Utils.dirname(fileUri);
    sinon.stub(workspace.fs, "validateDirectoryPath").callsFake(async (uri: URI) => uri.path === settingDir.path);

    const res = await normalizeDirPath(workspace as any, fileUri);
    assert.ok(res);
    assert.strictEqual(res!.path, settingDir.path);
  });

  test("returns joined path when relativeFromSettingDir is provided and exists (unit)", async () => {
    const fileUri = URI.file("/workspace/proj/localize-support.json");
    const settingDir = Utils.dirname(fileUri);
    const rel = "./src";
    const expected = Utils.joinPath(settingDir, rel);
    sinon.stub(workspace.fs, "validateDirectoryPath").callsFake(async (u: URI) => u.path === expected.path);

    const res = await normalizeDirPath(workspace as any, fileUri, rel);
    assert.ok(res);
    assert.strictEqual(res!.path, expected.path);
  });

  test("uses workspace folder when file is index and directory exists (unit)", async () => {
    const folderUri = URI.file("/workspace/folderA");
    sinon.stub(workspace, "getWorkspaceFolders").returns([{ uri: folderUri, name: "folderA", index: 0 }]);
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(true);

    const res = await normalizeDirPath(workspace as any, 0);
    assert.ok(res);
    assert.strictEqual(res!.path, folderUri.path);
  });

  test("returns undefined when validateDirectoryPath returns false (unit)", async () => {
    const fileUri = URI.file("/workspace/proj/localize-support.json");
    sinon.stub(workspace.fs, "validateDirectoryPath").resolves(false);
    const res = await normalizeDirPath(workspace as any, fileUri);
    assert.strictEqual(res, undefined);
  });
});
