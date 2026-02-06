import './setup';
import * as assert from 'assert';
import { findAllLocalizationCalls, findLocalizationCallAtOffset, extractFirstStringArgumentRange } from '../utils';

suite('Range regression tests for localization calls', () => {
  test('findAllLocalizationCalls returns inner content bounds for normal string', () => {
    const text = 'var a = G("12345");';
    const calls = findAllLocalizationCalls(text, ['G']);
    assert.strictEqual(calls.length, 1);
    const c = calls[0];
    // find indices
    const idx1 = text.indexOf('1'); // expected start
    const idxClosingQuote = text.indexOf('"', text.indexOf(')') - 1); // but this is brittle, compute properly
    // better compute closing quote index
    const closingQuote = text.indexOf('"', text.indexOf('"') + 1);
    // Expect start to be index of first char inside quotes
    assert.strictEqual(c.start, idx1);
    // Expect end to be index of closing quote (exclusive)
    assert.strictEqual(c.end, closingQuote);
  });

  test('extractFirstStringArgumentRange returns expected start/end (basic)', () => {
    const inside = '  "12345" , 1,2';
    const res = extractFirstStringArgumentRange(inside, 0);
    assert.ok(res);
    // opening quote at index 2, first char at 3
    assert.strictEqual(res!.start, 3);
    // closing quote at index 8, end should be 8
    assert.strictEqual(res!.end, 8);
  });
});