import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

/* 
  .vscode-test.mjs の働きにより、 fixtures/workspaces/vscode/{pathToTest}/{testName} フォルダが
  事前にコピーされ、ワークスペースとして開かれた状態でテストが実行される。
  ここは "src/test/vscode/extension.test.ts" なので "extension" フォルダがワークスペースとして開かれる。
*/
suite("Fixture Test", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Copied fixture files should exist", async () => {
    const wsfs = vscode.workspace.workspaceFolders;
    assert.strictEqual(wsfs?.length ?? 0, 1, "There should be at least one workspace folder");
    const wsf = wsfs?.[0];
    if (wsf) {
      assert.strictEqual(wsf.name, "extension", "The workspace folder name should be 'extension'");
      const foo = await vscode.workspace.findFiles("foo.txt");
      assert.ok(foo.length > 0 && foo[0].path.endsWith("extension/foo.txt"), "foo.txt should exist in the workspace");
      const hoge = await vscode.workspace.findFiles("bar/hoge.txt");
      assert.ok(
        hoge.length > 0 && hoge[0].path.endsWith("extension/bar/hoge.txt"),
        "hoge.txt should exist in the workspace",
      );
    }
  });
});
