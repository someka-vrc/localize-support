import { defineConfig } from "@vscode/test-cli";
import * as fs from "fs/promises";
import * as path from "path";

const dateStr = new Date().toISOString().substring(0, 10);
const timeStr = new Date().toISOString().substring(11, 19).replace(/:/g, "-");

async function copyWorkspaceIfExists(subPath) {
  const srcDir = path.join(process.cwd(), "fixtures/workspaces/vscode", subPath);
  let exists = false;
  let destDir = undefined;
  try {
    await fs.access(srcDir);
    exists = true;
  } catch {}
  if (exists) {
    destDir = path.join(process.cwd(), ".tmp/fixtures", dateStr, timeStr, "vscode", subPath);
    await fs.cp(srcDir, destDir, { recursive: true });
  }
  return destDir;
}

const configs = (await fs.readdir("./src/test/vscode", { recursive: true }))
  .filter((f) => f.endsWith(".test.ts"))
  .map(async (f) => {
    const subPath = f.substring(0, f.length - 8);
    const files = path.join(process.cwd(), "out/test/vscode", `${subPath}.test.js`);
    let destDir = await copyWorkspaceIfExists(subPath);
    const launchArgs = [];
    if (destDir) {
      launchArgs.push(destDir);
    }
    return { files, launchArgs };
  });
export default defineConfig(Promise.all(configs));
