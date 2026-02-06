import * as assert from 'assert';
import { computeQuoteRangeFromDocLine } from '../../services/poDiagnostics';

suite('Helpers - quote range', () => {
  test('computeQuoteRangeFromDocLine finds quote bounds', () => {
    const fakeDoc: any = {
      lineAt: (n: number) => ({ text: 'msgid "hello"' })
    };
    const range = computeQuoteRangeFromDocLine(fakeDoc as any, 0);
    // start column should be index of first char inside quotes (7)
    assert.strictEqual(range.start.character, 7); // start = firstQuote+1
    // end column should be index of second quote
    assert.ok(range.end.character > range.start.character);
  });
});
