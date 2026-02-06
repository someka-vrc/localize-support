import * as assert from 'assert';
const proxyquire: any = require('proxyquire');

suite('TreeSitterSourceParser (unit)', () => {
  test('init success and parsing yields calls', async () => {
    let loadedUrl: string | null = null;
    // Mock web-tree-sitter
    const MockParser = function (this: any) {
      this.setLanguage = () => {};
      this.parse = (_text: string) => ({ rootNode: {} });
    } as any;
    const MockQuery = function (this: any, _lang: any, _q: string) {
      this.captures = (_root: any) => [
        { name: 'func-name', node: { text: 'G', startIndex: 0 } },
        { name: 'args', node: { startIndex: 2, endIndex: 9 } },
      ];
    } as any;
    const MockWTS = {
      init: async () => {},
      Language: {
        load: async (url: string) => {
          loadedUrl = url;
          return {};
        },
      },
      Parser: MockParser,
      Query: MockQuery,
    };

    const { TreeSitterSourceParser } = require('../../parsers/treeSitterSourceParser') as any;

    const p = new TreeSitterSourceParser('csharp', MockWTS);
    // Explicitly run init to ensure readiness and surface errors
    try {
      await (p as any).init();
    } catch (e) {
      assert.fail('init failed: ' + String(e));
    }

    const calls = p.findAllLocalizationCalls('G("hello")');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].msgid, 'hello');
    // assert that Language.load was called with CDN URL (default base + wasm name)
    assert.ok(typeof loadedUrl === 'string' && (loadedUrl as string).endsWith('tree-sitter-c_sharp.wasm'));
  });

  test('init failure leaves parser unready and throws on use', async () => {
    // Mock web-tree-sitter where init throws
    const MockWTS = {
      init: async () => { throw new Error('no wts'); },
    };
    const { TreeSitterSourceParser } = require('../../parsers/treeSitterSourceParser') as any;

    const p = new TreeSitterSourceParser('csharp', MockWTS);
    // await initPromise to allow constructor's init to run
    try { await (p as any).initPromise; } catch (_) { /* ignored */ }

    assert.throws(() => p.findAllLocalizationCalls('G("x")'), /Tree-sitter parser not ready/);
  });

  test('uses configured CDN base URL for loading wasm', async () => {
    let loadedUrl: string | null = null;
    const MockParser = function (this: any) { this.setLanguage = () => {}; this.parse = (_: string) => ({ rootNode: {} }); } as any;
    const MockQuery = function (this: any) { this.captures = (_: any) => []; } as any;
    const MockWTS = {
      init: async () => {},
      Language: {
        load: async (url: string) => { loadedUrl = url; return {}; },
      },
      Parser: MockParser,
      Query: MockQuery,
    };
    const MockVscode = {
      workspace: {
        getConfiguration: () => ({ get: (_k: string) => 'https://example.com/' }),
      },
    };

    const { TreeSitterSourceParser } = require('../../parsers/treeSitterSourceParser') as any;

    const p = new TreeSitterSourceParser('csharp', MockWTS, MockVscode);
    try {
      await (p as any).init();
    } catch (e) {
      assert.fail('init failed: ' + String(e));
    }
    assert.ok(typeof loadedUrl === 'string' && (loadedUrl as string).startsWith('https://example.com/'));
  });

  test('unsupported language results in not-ready parser', async () => {
    const { TreeSitterSourceParser } = require('../../parsers/treeSitterSourceParser') as any;

    const p = new TreeSitterSourceParser('no-such-lang');
    assert.throws(() => p.findAllLocalizationCalls('G("x")'), /Tree-sitter parser not ready/);
  });
});
