import './setup';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { collectAllConfigsInWorkspace } from '../../config';
import * as path from 'path';

// This test has been moved to integration tests (requires full VS Code environment).
// Run with: npm run test:integration
// Kept as a stub so running `npm test:unit` won't attempt to run VS Code-bound tests.

suite('Config - collectAllConfigsInWorkspace (integration - moved)', () => {
  test('skipped in unit runs', () => {
    console.warn('Skipping integration test: move to integration suite and run `npm run test:integration`.');
  });
});
