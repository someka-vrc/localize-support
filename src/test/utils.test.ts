import './unit/setup';
import * as assert from 'assert';
import { parsePoEntries, extractFirstStringArgumentRange } from '../utils';

suite('Utils - parsePoEntries', () => {
  test('detects duplicate msgid entries', () => {
    const content = `msgid "hello"
msgstr "こんにちは"

msgid "hello"
msgstr "やあ"
`;
    const entries = parsePoEntries(content);
    const helloEntries = entries.filter(e => e.id === 'hello');
    assert.strictEqual(helloEntries.length, 2);
    assert.strictEqual(helloEntries[0].translation, 'こんにちは');
    assert.strictEqual(helloEntries[1].translation, 'やあ');
  });

  test('ignores header (empty msgid) entries', () => {
    const content = `msgid ""
msgstr ""
"Language: ja\\n"

msgid "hello"
msgstr "こんにちは"
`;
    const entries = parsePoEntries(content);
    // header entry (empty id) should not be present
    assert.strictEqual(entries.find(e => e.id === '') === undefined, true);
    const hello = entries.find(e => e.id === 'hello');
    assert.ok(hello);
    assert.strictEqual(hello!.translation, 'こんにちは');
  });

  test('keeps empty msgid entry when msgstr non-empty', () => {
    const content = `msgid ""
msgstr "some value"
`;
    const entries = parsePoEntries(content);
    const emptyEntry = entries.find(e => e.id === '');
    assert.ok(emptyEntry);
    assert.strictEqual(emptyEntry!.translation, 'some value');
  });

  test('extractFirstStringArgumentRange - basic', () => {
    const inside = '  "hello" , 1,2';
    const res = extractFirstStringArgumentRange(inside, 0);
    assert.ok(res);
    assert.strictEqual(res!.msgid, 'hello');
    // opening quote at index 2, first char at 3
    assert.strictEqual(res!.start, 3);
    // closing quote at index 8, end should be 8
    assert.strictEqual(res!.end, 8);
  });

  test('extractFirstStringArgumentRange - escaped', () => {
    const inside = '"abc\\\"d"';
    const res = extractFirstStringArgumentRange(inside, 0);
    assert.ok(res);
    assert.strictEqual(res!.msgid, 'abc"d');
    // start should point to the first char inside (index 1 in this case)
    assert.strictEqual(res!.start, inside.indexOf('"') + 1);
    // end should point to the closing quote index (exclusive)
    assert.strictEqual(res!.end, inside.lastIndexOf('"'));
  });

  test('findAllLocalizationCalls and findLocalizationCallAtOffset', () => {
    const { findAllLocalizationCalls, findLocalizationCallAtOffset } = require('../utils');
    const text = `var a = G("hello");\nvar b = G(@"multi ""quote"" test");`;
    const calls = findAllLocalizationCalls(text, ['G']);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].msgid, 'hello');
    assert.strictEqual(calls[1].msgid, 'multi "quote" test');

    const callAt = findLocalizationCallAtOffset(text, text.indexOf('hello') + 1, ['G']);
    assert.ok(callAt);
    assert.strictEqual(callAt.msgid, 'hello');
  });
});
