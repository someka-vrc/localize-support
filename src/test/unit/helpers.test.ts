import * as assert from 'assert';
import { computeQuoteRangeFromDocLine, detectDuplicateMap } from '../../services/poDiagnostics';
import { parsePoEntries } from '../../utils';

suite('PODiagnostics helpers (additional)', () => {
  test('computeQuoteRangeFromDocLine fallback on errors', () => {
    const badDoc: any = { lineAt: (n: number) => { throw new Error('boom'); } };
    const range = computeQuoteRangeFromDocLine(badDoc as any, 3);
    assert.strictEqual(range.start.line, 3);
    assert.strictEqual(range.start.character, 0);
  });

  test('detectDuplicateMap works with parsePoEntries', () => {
    const content = `msgid "a"\nmsgstr "t1"\n\nmsgid "b"\nmsgstr "t2"\n\nmsgid "a"\nmsgstr "t3"\n`;
    const entries = parsePoEntries(content);
    const dups = detectDuplicateMap(entries);
    assert.strictEqual(dups.has('a'), true);
    assert.strictEqual(dups.get('a')!.length, 2);
  });
});