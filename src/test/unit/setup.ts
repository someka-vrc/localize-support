// Test environment compatibility shim
// Make `suite`, `describe`, `test`, and `it` available across different runners
declare const global: any;
// If mocha-like APIs exist, map them
if (typeof (global as any).suite === 'undefined' && typeof (global as any).describe === 'function') {
  (global as any).suite = (global as any).describe;
}
if (typeof (global as any).describe === 'undefined' && typeof (global as any).suite === 'function') {
  (global as any).describe = (global as any).suite;
}
// Provide minimal fallbacks so tests can run under simple runners (e.g., Bun's test runner)
if (typeof (global as any).suite === 'undefined') {
  (global as any).suite = function (name: string, fn: () => void) { try { fn(); } catch (e) { throw e; } };
}
if (typeof (global as any).describe === 'undefined') {
  (global as any).describe = (global as any).suite;
}
if (typeof (global as any).test === 'undefined') {
  (global as any).test = function (name: string, fn: (t?: any) => void) {
    // if the runner provides an argument, try to detect and call appropriately
    try { fn(); } catch (e) { throw e; }
  };
}
if (typeof (global as any).it === 'undefined') {
  (global as any).it = (global as any).test;
}
// Provide a no-op before/after hooks if missing
if (typeof (global as any).before === 'undefined') { (global as any).before = function () {}; }
if (typeof (global as any).after === 'undefined') { (global as any).after = function () {}; }
if (typeof (global as any).beforeEach === 'undefined') { (global as any).beforeEach = function () {}; }
if (typeof (global as any).afterEach === 'undefined') { (global as any).afterEach = function () {}; }
