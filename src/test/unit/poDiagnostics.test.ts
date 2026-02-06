import * as assert from 'assert';
import { determineUnusedStatuses, detectDuplicateMap } from '../../services/poDiagnostics';
import { parsePoEntries } from '../../utils';

suite('PO Diagnostics - helpers', () => {
  test('determineUnusedStatuses filters untranslated and referenced', () => {
    const statuses: any[] = [
      { uri: 'a.po' as any, relativePath: 'a.po', hasEntry: true, translation: 't1', line: 1 },
      { uri: 'b.po' as any, relativePath: 'b.po', hasEntry: true, translation: '', line: 2 },
    ];
    const refsResolver = (msgid: string) => {
      if (msgid === 'refed') {return [{ uri: 'x.cs' as any, range: {} as any }];}
      return [];
    };

    const unused = determineUnusedStatuses('unused', statuses, refsResolver as any, []);
    assert.strictEqual(unused.length, 1);
    assert.strictEqual(unused[0].relativePath, 'a.po');

    const unused2 = determineUnusedStatuses('refed', statuses, refsResolver as any, []);
    assert.strictEqual(unused2.length, 0);
  });

  test('detectDuplicateMap finds duplicates', () => {
    const content = `msgid "hello"
msgstr "t1"

msgid "hello"
msgstr "t2"
`;
    const entries = parsePoEntries(content);
    const d = detectDuplicateMap(entries);
    assert.strictEqual(d.has('hello'), true);
    const arr = d.get('hello')!;
    assert.strictEqual(arr.length, 2);
  });
});