import * as assert from 'assert';
import { registerDefinitionProvider } from '../providers/definitionProvider';
import { registerHoverProvider } from '../providers/hoverProvider';
import { registerCompletionProvider } from '../providers/completionProvider';
import { registerReferenceProvider } from '../providers/referenceProvider';

suite('Providers exports', () => {
  test('Providers are exported', () => {
    assert.strictEqual(typeof registerDefinitionProvider, 'function');
    assert.strictEqual(typeof registerHoverProvider, 'function');
    assert.strictEqual(typeof registerCompletionProvider, 'function');
    assert.strictEqual(typeof registerReferenceProvider, 'function');
  });
});
