import * as assert from 'assert';
import { parsePoEntries } from '../utils';

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
});
