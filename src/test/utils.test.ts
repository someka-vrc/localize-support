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
});
