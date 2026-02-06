import * as assert from 'assert';
import { setSourceParsers, findAllLocalizationCalls, getSourceParserManager } from '../utils';
import { RegexSourceParser } from '../parsers/regexSourceParser';
import { SourceParser } from '../parsers/sourceParser';

suite('Parsers', () => {
  test('default parser finds calls (regex)', () => {
    // reset to default (Regex)
    setSourceParsers([new RegexSourceParser()]);
    const text = `var a = G("hello");\nvar b = G(@"multi \"line\"");`;
    const calls = findAllLocalizationCalls(text, ['G']);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].msgid, 'hello');
  });

  test('custom parser can replace behavior', () => {
    const fake: SourceParser = {
      findAllLocalizationCalls: (text: string) => [{ msgid: 'X', start: 1, end: 2, callStart: 0, callEnd: 3, funcName: 'FAKE' }],
      findLocalizationCallAtOffset: () => null,
    };
    setSourceParsers([fake]);
    const calls = findAllLocalizationCalls('irrelevant', ['G']);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].msgid, 'X');
  });

  test('fallback: failing parser is skipped', () => {
    const bad: SourceParser = {
      findAllLocalizationCalls: () => { throw new Error('boom'); },
      findLocalizationCallAtOffset: () => { throw new Error('boom'); },
    };
    const regex = new RegexSourceParser();
    setSourceParsers([bad, regex]);
    const text = `G("ok")`;
    const calls = findAllLocalizationCalls(text, ['G']);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].msgid, 'ok');
  });

  // restore default for other tests
  teardown(() => {
    setSourceParsers([new RegexSourceParser()]);
  });
});
