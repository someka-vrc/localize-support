import './setup';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { POManager } from '../services/poManager';
import { computeUnusedPoDiagnostics } from '../services/poDiagnostics';

// This test has been moved to the integration suite (requires full VS Code environment).
// Run with: npm run test:integration

suite('PODiagnostics - integration (moved)', () => {
  test('skipped in unit runs', () => {
    console.warn('Skipping PODiagnostics integration test in unit runs; see src/test/integration for the full test.');
  });
});
