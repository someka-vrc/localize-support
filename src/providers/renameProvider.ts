import * as vscode from "vscode";
import { L10nService } from "../services/l10nService";
import { MyPosition, MyLocation } from "../models/vscTypes";

/**
 * ローカライズキーのリネームを提供する `RenameProvider` 実装。
 *
 * - `L10nService` からキーの出現箇所（コード / 翻訳ファイル）を収集して `WorkspaceEdit` を作成する。
 * - `prepareRename` でカーソル位置のキー範囲を特定し、`provideRenameEdits` でコード内リテラルと `.po` の両方を安全に置換する（引用符の保持・PO のエスケープを実施）。
 * - リネーム可能性は `L10nService.canRenameKey` で検査し、競合があれば例外を投げる。
 */
export class RenameProvider implements vscode.RenameProvider {
  constructor(private svc: L10nService) {}

  private async openDoc(uri: vscode.Uri) {
    return vscode.workspace.openTextDocument(uri);
  }

  /**
   * Retry helper: wait until L10nService can report locations for the key at the given position.
   * Returns null when timeout elapses.
   */
  private async waitForTargets(uri: vscode.Uri | any, position: MyPosition, timeoutMs: number = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const t = this.svc.collectLocationsForKeyAt(uri as any, position);
      // require not only a key but also at least one known location to make
      // provideRenameEdits produce concrete WorkspaceEdit entries
      if (
        t &&
        t.key &&
        ((t.codeLocations && t.codeLocations.length > 0) || (t.translationLocations && t.translationLocations.length > 0))
      ) {
        return t;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  private async findInnerRangeForKeyInDocument(
    doc: vscode.TextDocument,
    fullRange: vscode.Range,
    key: string,
  ): Promise<vscode.Range | null> {
    const text = doc.getText(fullRange);
    // try to locate the raw key text inside the literal/po range
    const idx = text.indexOf(key);
    if (idx >= 0) {
      const baseOffset = doc.offsetAt(fullRange.start);
      const startOffset = baseOffset + idx;
      const endOffset = startOffset + key.length;
      return new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
    }

    // fallback: find first/last quote and return inner area
    const firstQuote = text.search(/['"`]/);
    if (firstQuote >= 0) {
      const quoteChar = text[firstQuote];
      const lastQuote = text.lastIndexOf(quoteChar);
      if (lastQuote > firstQuote) {
        const baseOffset = doc.offsetAt(fullRange.start);
        const startOffset = baseOffset + firstQuote + 1;
        const endOffset = baseOffset + lastQuote;
        return new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
      }
    }

    return null;
  }

  public async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Range | { range: vscode.Range; placeholder: string } | null> {
    const myPos = { line: position.line, character: position.character } as MyPosition;

    const targets = await this.waitForTargets(document.uri as any, myPos, 2000);
    if (!targets || !targets.key) {
      throw new Error("Place the cursor on a localization key to rename.");
    }

    const { key, codeLocations, translationLocations } = targets;

    // locate the matching location within this document
    const all = [...(codeLocations || []), ...(translationLocations || [])];
    const match = all.find((l) => (l.uri as any).path === (document.uri as any).path &&
      !(position.line < l.range.start.line || position.line > l.range.end.line || (position.line === l.range.start.line && position.character < l.range.start.character) || (position.line === l.range.end.line && position.character > l.range.end.character))
    );

    if (match) {
      const vscUri = vscode.Uri.parse((match.uri as any).toString());
      const doc = await this.openDoc(vscUri);
      const fullRange = new vscode.Range(
        match.range.start.line,
        match.range.start.character,
        match.range.end.line,
        match.range.end.character,
      );
      const inner = await this.findInnerRangeForKeyInDocument(doc, fullRange, key);
      if (inner) {
        return { range: inner, placeholder: key };
      }
    }

    // conservative fallback: return the word-range or current position
    const wr = document.getWordRangeAtPosition(position, /[\w.:-]+/);
    if (wr) {
      return { range: wr, placeholder: key };
    }
    return { range: new vscode.Range(position, position), placeholder: key };
  }

  public async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): Promise<vscode.WorkspaceEdit | null> {
    const myPos = { line: position.line, character: position.character } as MyPosition;
    const targets = await this.waitForTargets(document.uri as any, myPos, 2000);
    if (!targets || !targets.key) {
      return null;
    }

    const oldKey = targets.key;

    const conflict = this.svc.canRenameKey(oldKey, newName);
    if (!conflict.ok) {
      // conflict — do not perform edits
      // 例外は自動的にVSCodeの通知メッセージとして表示される
      throw new Error(`Cannot rename '${oldKey}' → '${newName}': target key already exists in translations`);
    }

    const codeLocs = targets.codeLocations || [];
    const transLocs = targets.translationLocations || [];

    const edit = new vscode.WorkspaceEdit();

    // replace in code locations (preserve quotes/prefixes when necessary)
    for (const l of codeLocs) {
      const uriStr = (l.uri as any).toString();
      const vscUri = vscode.Uri.parse(uriStr);
      const doc = await this.openDoc(vscUri);
      const fullRange = new vscode.Range(l.range.start.line, l.range.start.character, l.range.end.line, l.range.end.character);
      const inner = await this.findInnerRangeForKeyInDocument(doc, fullRange, oldKey);
      if (inner) {
        edit.replace(vscUri, inner, newName);
      } else {
        // fallback: preserve surrounding quote characters if present
        const fullText = doc.getText(fullRange);
        const m = fullText.match(/^\s*(['"`]+)/);
        const quote = m ? m[1][0] : '"';
        const replacement = `${quote}${newName}${quote}`;
        edit.replace(vscUri, fullRange, replacement);
      }
    }

    // replace in translation files (.po) — replace the entire msgid region with properly escaped quoted string
    const escapePo = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    for (const l of transLocs) {
      const uriStr = (l.uri as any).toString();
      const vscUri = vscode.Uri.parse(uriStr);
      const doc = await this.openDoc(vscUri);
      const fullRange = new vscode.Range(l.range.start.line, l.range.start.character, l.range.end.line, l.range.end.character);
      const replacement = `"${escapePo(newName)}"`;
      edit.replace(vscUri, fullRange, replacement);
    }

    return edit;
  }
}
