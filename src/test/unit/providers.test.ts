import * as assert from 'assert';
import { findAllLocalizationCalls } from '../../utils';

suite('Providers - replaced with utils smoke tests', () => {
  test('findAllLocalizationCalls finds calls', () => {
    const text = 'var a = G("hello"); var b = G(@"multi ""q""uote");';
    const calls = findAllLocalizationCalls(text, ['G']);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].msgid, 'hello');
  });
});
