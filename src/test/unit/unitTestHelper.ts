import * as fs from "fs/promises";
import * as path from "path";

const dateStr = new Date().toISOString().substring(0, 10);
const timeStr = new Date().toISOString().substring(11, 19).replace(/:/g, "-");

export type DisposablePath = {
    path: string;
    dispose: () => Promise<void>;
};

/**
 * ワークスペースのフィクスチャフォルダを一時コピーする
 * @param subPath `src/test/bar/foo.test.ts` の場合 `bar/foo`
 * @returns 
 */
export async function copyWorkspaceIfExists(
  subPath: string,
): Promise<DisposablePath | undefined> {
  const srcDir = path.join(process.cwd(), "fixtures/workspaces/unit", subPath);
  let exists = false;
  let destDir = undefined;
  try {
    await fs.access(srcDir);
    exists = true;
  } catch {}
  if (exists) {
    destDir = path.join(process.cwd(), ".tmp/fixtures", dateStr, timeStr, 'unit', subPath);
    await fs.cp(srcDir, destDir, { recursive: true });
  }
  return destDir
    ? {
        path: destDir,
        dispose: async () => {
          await fs.rm(destDir, { recursive: true, force: true });
        },
      }
    : undefined;
}
