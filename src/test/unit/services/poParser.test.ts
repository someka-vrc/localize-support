import assert from "assert";
import { PoParser } from "../../../services/poParser";
import { MyDiagnosticSeverity } from "../../../models/vscTypes";
import { URI } from "vscode-uri";

suite("PoParser", () => {
  test("parses simple msgid/msgstr", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/en.po", fsPath: "d:/dummy/en.po" } as URI;
    const content = `msgid "Hello"\nmsgstr "こんにちは"\n`;

    const res = await parser.parse(uri, content);
    assert.ok(res.success, "should succeed");
    assert.strictEqual(Object.keys(res.entries).length, 1);
    const langEntries = res.entries["en"];
    assert.ok(langEntries, "entries for 'en' should exist");
    assert.strictEqual(langEntries["Hello"].translation, "こんにちは");
    assert.strictEqual(res.diagnostics.length, 0);
    // location should have non-zero range
    const loc = langEntries["Hello"].location.range;
    assert.ok(loc.start.character < loc.end.character, "msgid location should span characters");
  });

  test("parses header language override and multiline msgstr", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/xx.po", fsPath: "d:/dummy/xx.po" } as URI;
    const content = `msgid ""\nmsgstr "Language: ja\\n"\n\nmsgid "KEY"\nmsgstr "Line1\\n"\n"Line2"\n`;

    const res = await parser.parse(uri, content);
    assert.ok(res.success, "should succeed");
    // language should be overridden to 'ja'
    assert.ok(res.entries["ja"], "language should be overridden to 'ja'");
    const e = res.entries["ja"]["KEY"];
    assert.ok(e, "entry KEY should exist");
    assert.strictEqual(e.translation, "Line1\nLine2");
  });

  test("reports unexpected continuation outside of msgid/msgstr", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/err.po", fsPath: "d:/dummy/err.po" } as URI;
    const content = `"alone"\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    const diag = res.diagnostics.find((d) => /unexpected continuation/.test(d.message));
    assert.ok(diag);
    // diagnostic range should have non-zero length
    if (diag) {
      assert.ok(diag.range.start.character < diag.range.end.character);
    }
  });

  test("reports duplicate msgid as warning", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/dup.po", fsPath: "d:/dummy/dup.po" } as URI;
    const content = `msgid "DUP"\nmsgstr "One"\n\nmsgid "DUP"\nmsgstr "Two"\n`;

    const res = await parser.parse(uri, content);
    assert.ok(res.diagnostics.some((d) => /duplicate msgid/.test(d.message)));
    // last value should overwrite previous in current implementation
    const entries = res.entries["dup"]; // basename dup
    assert.strictEqual(entries["DUP"].translation, "Two");
  });

  test("reports empty msgstr as error", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/empty.po", fsPath: "d:/dummy/empty.po" } as URI;
    const content = `msgid "EMPTY"\nmsgstr ""\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    assert.ok(res.diagnostics.some((d) => /empty msgstr/.test(d.message) && d.severity === MyDiagnosticSeverity.Error));
  });

  test("reports invalid msgstr format (missing quote) as error", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/badquote.po", fsPath: "d:/dummy/badquote.po" } as URI;
    const content = `msgid "BAD"\nmsgstr "not closed\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    assert.ok(
      res.diagnostics.some((d) => /invalid msgstr format/.test(d.message) && d.severity === MyDiagnosticSeverity.Error),
    );
  });

  test("reports missing msgstr as error", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/missing.po", fsPath: "d:/dummy/missing.po" } as URI;
    const content = `msgid "MISSING"\n\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    assert.ok(
      res.diagnostics.some((d) => /missing msgstr/.test(d.message) && d.severity === MyDiagnosticSeverity.Error),
    );
  });

  test("ignores comment lines", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/comments.po", fsPath: "d:/dummy/comments.po" } as URI;
    const content = `# comment\nmsgid "C"\n# another\nmsgstr "訳"\n`;

    const res = await parser.parse(uri, content);
    assert.ok(res.success, "should succeed");
    const entries = res.entries["comments"];
    assert.ok(entries && entries["C"] && entries["C"].translation === "訳");
  });

  test("reports invalid msgid format (missing quote) as error", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/badmsgid.po", fsPath: "d:/dummy/badmsgid.po" } as URI;
    const content = `msgid notquoted\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    assert.ok(
      res.diagnostics.some((d) => /invalid msgid format/.test(d.message) && d.severity === MyDiagnosticSeverity.Error),
    );
  });

  test("parses multiline msgid continuation", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/multimsgid.po", fsPath: "d:/dummy/multimsgid.po" } as URI;
    const content = `msgid "HEL"\n"LO"\nmsgstr "こんにちは"\n`;

    const res = await parser.parse(uri, content);
    assert.ok(res.success, "should succeed");
    const entries = res.entries["multimsgid"];
    assert.ok(entries["HELLO"]);
    assert.strictEqual(entries["HELLO"].translation, "こんにちは");
  });

  test("reports unrecognized line as warning", async () => {
    const parser = new PoParser();
    const uri = { scheme: "file", path: "d:/dummy/unrec.po", fsPath: "d:/dummy/unrec.po" } as URI;
    const content = `weird\n`;

    const res = await parser.parse(uri, content);
    assert.strictEqual(res.success, false);
    assert.ok(
      res.diagnostics.some(
        (d) => /unrecognized line in \.po/.test(d.message) && d.severity === MyDiagnosticSeverity.Warning,
      ),
    );
  });
});
