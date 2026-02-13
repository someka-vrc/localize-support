import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import { URI, Utils } from "vscode-uri";
import { copyWorkspaceIfExists, type DisposablePath } from "../unitTestHelper";
import { CodeParser } from "../../../services/codeParser";
import { WasmDownloader, WasmFileNames } from "../../../services/wasmDownloader";
import { CodeLanguage } from "../../../models/l10nTypes";
import { DiagnosticCollection, IWorkspaceService, MyFileStat, MyFileType } from "../../../models/vscTypes";

// Disk-backed minimal IWorkspaceService used only for wasm storage in tests
class DiskWorkspaceService implements IWorkspaceService {
  async findFiles(): Promise<URI[]> {
    return [];
  }
  async readFile(uri: URI): Promise<Uint8Array> {
    return fs.readFile(uri.fsPath);
  }
  async writeFile(uri: URI, content: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    return fs.writeFile(uri.fsPath, Buffer.from(content));
  }
  async deleteFile(uri: URI): Promise<void> {
    try {
      await fs.unlink(uri.fsPath);
    } catch {}
  }
  async stat(uri: URI): Promise<MyFileStat> {
    const s = await fs.stat(uri.fsPath);
    return {
      type: s.isDirectory() ? MyFileType.Directory : MyFileType.File,
      ctime: s.ctimeMs,
      mtime: s.mtimeMs,
      size: s.size,
    };
  }
  async validateDirectoryPath(uri: URI): Promise<boolean> {
    try {
      const s = await fs.stat(uri.fsPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }
  async getTextDocumentContent(): Promise<string> {
    return "";
  }
  getWorkspaceFolders() {
    return [] as any;
  }
  getConfiguration(): any {
    return { get: <T>() => undefined };
  }
  async createDirectory(uri: URI): Promise<void> {
    await fs.mkdir(uri.fsPath, { recursive: true });
  }
  onDidChangeTextDocument() {
    return { dispose: () => {} };
  }
  onDidChangeConfiguration() {
    return { dispose: () => {} };
  }
  createFileSystemWatcher() {
    return { dispose: () => {} };
  }
  createDiagnosticCollection(name: string): DiagnosticCollection {
    throw new Error("Method not implemented.");
  }
}

suite("CodeParser (unit, integration with wasm)", () => {
  // use a real disk-backed workspace so WasmDownloader caches files under .tmp/wasms/
  const storageDir = path.join(process.cwd(), ".tmp/wasms");
  const storageUri = URI.file(storageDir);
  const wasmCdnBase = "https://unpkg.com/tree-sitter-wasms@{version}/out";

  let workspaceFixture: DisposablePath | undefined;

  setup(async () => {
    // ensure fixtures directory exists (some tests expect it)
    workspaceFixture = await copyWorkspaceIfExists("unitTestHelper");
    await fs.mkdir(storageDir, { recursive: true });
  });

  teardown(async () => {
    // keep .tmp/wasms/ to allow caching between test runs
    if (workspaceFixture) {
      await workspaceFixture.dispose();
    }
  });

  test("parses string literals and member calls (downloads wasm to .tmp/wasms)", async function () {
    // allow longer time for first-time download
    this.timeout(30_000);

    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "javascript");

    // pre-warm / retry download so transient network/404 doesn't make the test flaky
    const maxAttempts = 3;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await downloader.retrieveWasmFile(wasmCdnBase, "javascript");
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // small backoff
        await new Promise((res) => setTimeout(res, 200 * attempt));
      }
    }
    if (lastErr) {
      throw new Error(`failed to download wasm before parsing: ${String(lastErr)}`);
    }

    const src = `
      t("hello.world");
      t('single-quoted');
      i18n.t("member.call");
      t(\`static-template\`);
      // should not capture non-function-invocation string
      const s = "not_a_call";
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));

    // expect keys for each call site
    const keys = fragments.map((f) => f.key).sort();

    // If no captures, it's likely the language failed to load — provide actionable error
    assert.ok(
      fragments.length > 0,
      `CodeParser.parse returned no captures. (found keys: ${JSON.stringify(keys)})`,
    );

    assert.ok(keys.includes("hello.world"), `found keys: ${JSON.stringify(keys)}`);
    assert.ok(keys.includes("single-quoted"), `found keys: ${JSON.stringify(keys)}`);
    assert.ok(keys.includes("member.call"), `found keys: ${JSON.stringify(keys)}`);
    assert.ok(keys.includes("static-template"), `found keys: ${JSON.stringify(keys)}`);

    // locations should have valid line numbers (0-based) and the URI we passed
    const expectedUri = URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js'));
    for (const f of fragments) {
      assert.ok(typeof f.location.range.start.line === "number");
      assert.ok(typeof f.location.range.end.line === "number");
      assert.strictEqual(f.location.uri.fsPath, expectedUri.fsPath);
    }

    // wasm file should be cached on disk under .tmp/wasms/wasm/{version}/
    const expectedWasmPath = path.join(
      storageDir,
      "wasm",
      "0.1.13",
      "tree-sitter-javascript.wasm",
    );
    const stat = await fs.stat(expectedWasmPath);
    assert.ok(stat.size > 0, `wasm binary should exist at ${expectedWasmPath}`);
  });

  // helper used by multiple language test cases
  async function runParserLangTest(
    language: CodeLanguage,
    src: string,
    expectedKeys: string[],
  ) {
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, language);

    // pre-warm / retry download so transient network/404 doesn't make the test flaky
    const maxAttempts = 3;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await downloader.retrieveWasmFile(wasmCdnBase, language);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // small backoff
        await new Promise((res) => setTimeout(res, 200 * attempt));
      }
    }
    if (lastErr) {
      throw new Error(`failed to download wasm before parsing: ${String(lastErr)}`);
    }

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key).sort();

    assert.ok(
      fragments.length > 0,
      `CodeParser.parse returned no captures for ${language}. (found keys: ${JSON.stringify(keys)})`,
    );

    for (const k of expectedKeys) {
      assert.ok(keys.includes(k), `expected key "${k}" for ${language} (found: ${JSON.stringify(keys)})`);
    }

    // wasm file should be cached on disk under .tmp/wasms/wasm/{version}/
    const expectedWasmPath = path.join(storageDir, "wasm", "0.1.13", WasmFileNames[language]);
    const stat = await fs.stat(expectedWasmPath);
    assert.ok(stat.size > 0, `wasm binary should exist at ${expectedWasmPath}`);
  }

  test("parses TypeScript function calls (typescript, downloads wasm)", async function () {
    this.timeout(30_000);

    const src = `
      t("ts.hello");
      t('ts-single');
      obj.t("ts.member.call");
      const s = "not_a_call";
    `;

    await runParserLangTest("typescript", src, ["ts.hello", "ts-single", "ts.member.call"]);
  });

  test("parses Python function/attribute calls (python, downloads wasm)", async function () {
    this.timeout(30_000);

    const src = `
      t("py.hello")
      t('py-single')
      i18n.t("py.member.call")
      s = "not_a_call"
    `;

    await runParserLangTest("python", src, ["py.hello", "py-single", "py.member.call"]);
  });

  test("parses C# invocation expressions (csharp, downloads wasm)", async function () {
    this.timeout(30_000);

    const src = `
      t("cs.hello");
      t("cs-single");
      i18n.t("cs.member.call");
      var s = "not_a_call";
    `;

    await runParserLangTest("csharp", src, ["cs.hello", "cs-single", "cs.member.call"]);
  });

  test("parses Java method invocations (java, downloads wasm)", async function () {
    this.timeout(30_000);

    const src = `
      t("java.hello");
      t("java-single");
      obj.t("java.member.call");
      String s = "not_a_call";
    `;

    await runParserLangTest("java", src, ["java.hello", "java-single", "java.member.call"]);
  });

  test("rejects computed-property calls, interpolated and concatenated strings (javascript)", async function () {
    this.timeout(30_000);
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "javascript");

    // pre-warm
    await downloader.retrieveWasmFile(wasmCdnBase, "javascript");

    const src = `
      t("ok");
      obj['t']("computed");
      t(` + "`templ ${v}`" + `);
      t(123, "second_arg");
      t("a" + "b");
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key);

    // only the static first call should be captured
    assert.ok(keys.includes("ok"));
    assert.ok(!keys.includes("computed"));
    assert.ok(!keys.some((k) => k.includes("templ")));
    assert.ok(!keys.includes("second_arg"));
    assert.ok(!keys.includes("ab"));
  });

  test("rejects computed-property calls and templates (typescript)", async function () {
    this.timeout(30_000);
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "typescript");

    await downloader.retrieveWasmFile(wasmCdnBase, "typescript");

    const src = `
      t("ok");
      obj['t']("computed");
      t(` + "`ts ${v}`" + `);
      t("a" + "b");
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key);

    assert.ok(keys.includes("ok"));
    assert.ok(!keys.includes("computed"));
    assert.ok(!keys.some((k) => k.includes("ts ")));
    assert.ok(!keys.includes("ab"));
  });

  test("Python: f-strings ignored, triple-quoted captured; implicit concatenation ignored", async function () {
    this.timeout(30_000);
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "python");

    await downloader.retrieveWasmFile(wasmCdnBase, "python");

    const src = `
      t("ok")
      obj['t']("computed")
      t(f"inter{v}")
      t("""multi\nline""")
      t("a" "b")
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key);

    assert.ok(keys.includes("ok"));
    assert.ok(!keys.includes("computed"));
    assert.ok(!keys.some((k) => k.includes("inter")));
    // triple-quoted should be captured as a single literal containing a newline
    assert.ok(keys.some((k) => k.includes("multi\nline")));
    // implicit concatenation is out-of-scope and should NOT be captured
    assert.ok(!keys.includes("a"));
    assert.ok(!keys.includes("b"));
  });

  test("C#: verbatim captured, interpolated ignored", async function () {
    this.timeout(30_000);
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "csharp");

    await downloader.retrieveWasmFile(wasmCdnBase, "csharp");

    const src = `
      t(@"verbatim");
      t($"interpolated {v}");
      obj.t("ok");
      // indexer-style should not be treated as a function member call
      obj['t']("computed");
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key);

    assert.ok(keys.includes("verbatim"));
    assert.ok(keys.includes("ok"));
    assert.ok(!keys.some((k) => k.includes("interpolated")));
    assert.ok(!keys.includes("computed"));
  });

  test("Java: concatenation ignored, simple/member calls captured", async function () {
    this.timeout(30_000);
    const diskWorkspace = new DiskWorkspaceService();
    const downloader = new WasmDownloader(diskWorkspace, storageUri);
    const parser = new CodeParser(downloader, "java");

    await downloader.retrieveWasmFile(wasmCdnBase, "java");

    const src = `
      t("ok");
      obj.t("member");
      t("a" + "b");
    `;

    const fragments = await parser.parse(["t"], wasmCdnBase, src, URI.file(path.join(process.cwd(), 'src', 'services', 'codeParser.test.js')));
    const keys = fragments.map((f) => f.key);

    assert.ok(keys.includes("ok"));
    assert.ok(keys.includes("member"));
    assert.ok(!keys.includes("ab"));
  });
});
