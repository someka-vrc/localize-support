import assert from "assert";
import { copyWorkspaceIfExists, type DisposablePath } from "./unitTestHelper";
import * as path from "path";
import * as fs from "fs/promises";

suite("unitTestHelper", () => {
  test("should fixture folder is copied", async () => {
    const workspace = await copyWorkspaceIfExists("unitTestHelper");
    assert.ok(workspace, "Workspace should be copied");

    const copied = path
      .relative(process.cwd(), workspace.path)
      .replace(/\//g, "\\");
    const pattern =
      /^\.tmp\\fixtures\\\d{4}-\d{2}-\d{2}\\\d{2}-\d{2}-\d{2}\\unit\\unitTestHelper$/;
    assert.match(
      copied,
      pattern,
      "Workspace path should match the expected pattern",
    );
    const files = await fs.readdir(workspace.path, { recursive: true });
    assert.deepStrictEqual(
      files.sort(),
      ["foo.txt", "bar", "bar\\hoge.txt"].sort(),
      "Copied files should match the fixture structure",
    );

    // Clean up
    await (workspace as DisposablePath).dispose();
  });
});
