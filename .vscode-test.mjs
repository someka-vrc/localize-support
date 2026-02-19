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

/**
 *
 * @returns {Promise<import('@vscode/test-cli').TestConfiguration>}
 */
async function createConfig(f) {
  const subPath = f.substring(0, f.length - 8);
  return {
    launchArgs: [
      "--disable-extensions", // 余計な拡張機能を読み込まない
      "--disable-gpu", // Windows環境でのノイズ削減に効果的
    ],
    files: path.join(process.cwd(), "out/test/vscode", `${subPath}.test.js`),
    workspaceFolder: await copyWorkspaceIfExists(subPath),
    mocha: {
      ui: "tdd",
      timeout: 10000,
      require: "source-map-support/register",
      reporter: "min",
    },
  };
}

/**
 *
 * @returns {Promise<import('@vscode/test-cli').TestConfiguration[]>}
 */
async function buildConfigs() {
  const fes = await fs.readdir("./src/test/vscode", { recursive: true });
  return await Promise.all(fes.filter((f) => f.endsWith(".test.ts")).map(createConfig));
}

export default defineConfig(buildConfigs());
