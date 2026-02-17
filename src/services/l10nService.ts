import {
  Disposable,
  MyDiagnostic,
  MyRange,
  MyPosition,
  MyLocation,
  MyDiagnosticSeverity,
  IWorkspaceWrapper,
  LogOutputChannel,
  DiagnosticsCode,
} from "../models/vscodeTypes";
import { URI } from "vscode-uri";
import type { DiagOrStatus } from "../models/interfaces";
import { CodeLanguage, CodeLanguages, L10nFormat, L10nFormats, L10nTarget, L10nEntry } from "../models/l10nTypes";
import { L10nTargetManager } from "./l10nTargetManager";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";
import { EventEmitter } from "events";
import { normalizeDirPath } from "../utils/util";

type TargetUnit = {
  manager?: L10nTargetManager;
  listenerDisposable?: Disposable;
};
/**
 * ローカライズサービス
 *
 * 翻訳ファイルとソースコードを監視して翻訳エントリとコード内のローカライズ関数呼び出しを解析し、
 * 診断情報を提供する。
 */
export class L10nService implements Disposable {
  private readonly settingsWatchers: Disposable[] = [];
  private readonly managers: Map<string, TargetUnit[]> = new Map();
  private readonly settingDiags: Map<string, DiagOrStatus> = new Map();
  private readonly reloadIntervalQueue: IntervalQueue<L10nService>;

  private readonly reloadedEmitter = new EventEmitter();

  constructor(
    private workspace: IWorkspaceWrapper,
    private logger: LogOutputChannel,
    private globalStorageUri: URI,
    reloadIntervalMs: number = 500,
  ) {
    this.reloadIntervalQueue = new IntervalQueue<L10nService>(
      reloadIntervalMs,
      async (thisArg) => {
        thisArg.reloadedEmitter.emit("reloaded", thisArg);
      },
      this.logger,
      OrganizeStrategies.lastOnly,
    );
  }

  /**
   * ローカライズ設定を監視する
   *
   * ファイルの変更、作成、削除を監視し、設定を再読み込みする。
   * 再度呼び出すと既存のウォッチャーとターゲットをクリアして再設定する。
   */
  async init(): Promise<void> {
    // clear existing watchers
    await Promise.all(this.settingsWatchers.map((d) => d.dispose()));
    this.settingsWatchers.length = 0;
    await this.disposeManagers();

    const settingsGlob = "**/localize-support.json";
    const foundSettingFile = await this.workspace.findFiles(settingsGlob);
    for (const settingFile of foundSettingFile) {
      await this.reload(settingFile);
    }

    // ファイルの変更
    const fsWatcher = this.workspace.createFileSystemWatcher(settingsGlob);
    fsWatcher.onDidCreate(async (uri) => await this.reload(uri));
    fsWatcher.onDidChange(async (uri) => await this.reload(uri));
    fsWatcher.onDidDelete(async (uri) => await this.unload(uri));
    this.settingsWatchers.push(fsWatcher);

    // 保存時のみ捕捉するのでコメントアウト
    // // 未保存の変更
    // const changeDoc = workspace.onDidChangeTextDocument(e => {
    //     if (e.document.fileName.endsWith('foo.json')) {
    //         console.log('foo.json が編集中です（未保存）');
    //     }
    // });
    // this.disposables.push(changeDoc);

    const configWatcher = this.workspace.onDidChangeConfiguration(async (e) => {
      const wsfs = this.workspace.getWorkspaceFolders() || [];
      for (let i = 0; i < wsfs.length; i++) {
        const wsf = wsfs[i];
        // 「このフォルダに関係する設定」が変更されたかチェック
        if (e.affectsConfiguration("localize-support.targets", wsf.uri)) {
          await this.reload(i);
        }
      }
    });
    this.settingsWatchers.push(configWatcher);

    this.reloadIntervalQueue.start();
  }

  async disposeManagersBySetting(settingPath: string): Promise<void> {
    for (const mgu of this.managers.get(settingPath) || []) {
      await mgu.manager?.dispose();
      mgu.listenerDisposable?.dispose();
    }
    this.managers.delete(settingPath);
    this.settingDiags.delete(settingPath);
  }

  async disposeManagers(): Promise<void> {
    for (const key of this.managers.keys()) {
      await this.disposeManagersBySetting(key);
    }
  }

  async dispose(): Promise<void> {
    this.reloadIntervalQueue.dispose();
    this.reloadedEmitter.removeAllListeners();
    await Promise.all(this.settingsWatchers.map((d) => d.dispose()));
    await this.disposeManagers();
    this.settingDiags.clear();
  }

  async unload(settingFile: URI): Promise<void> {
    await this.disposeManagersBySetting(this.getSettingPath(settingFile));
  }

  /**
   * ローカライズ設定の読み込み
   * @param settingFile localize-support.json の Uri または workspace folder index
   * @returns エラーメッセージの配列
   */
  async reload(settingFile: URI | number): Promise<void> {
    // reload requested for:
    let rawTargets: any[] = [];
    let isConfig = typeof settingFile === "number";

    // 既存のマネージャーを破棄
    await this.disposeManagersBySetting(this.getSettingPath(settingFile));
    // 設定jsonの読み込み
    if (isConfig) {
      const wsfs = this.workspace.getWorkspaceFolders() || [];
      const idx = settingFile as number;
      if (!(Number.isInteger(idx) && idx >= 0 && idx < wsfs.length)) {
        // invalid workspace index — record a status message and abort
        const msg = `Workspace folder index ${idx} is out of range.`;
        this.settingDiags.set(this.getSettingPath(settingFile), this.toDiags(settingFile, [msg]));
        return;
      }
      const folder = wsfs[idx];
      const config = this.workspace.getConfiguration("localize-support", folder.uri);
      rawTargets = config.get<any[]>("targets") || [];
    } else {
      let json: any;
      try {
        const buf = await this.workspace.fs.readFile(settingFile as URI);
        const content = Buffer.from(buf).toString();
        json = JSON.parse(content);
      } catch (error) {
        const msg = error && (error as any).message ? (error as any).message : String(error);
        const diags = this.toDiags(settingFile, [`Failed to read settings file: ${msg}`]);
        this.settingDiags.set(this.getSettingPath(settingFile), diags);
        return;
      }
      rawTargets = json.targets || [];
    }

    // 設定オブジェクト化
    const { targets, messages } = await this.normalizeSettingsObject(rawTargets, settingFile);
    // 新しいマネージャーを作成、登録
    const managers = await Promise.all(
      targets.map(async (t) => {
        const manager = new L10nTargetManager(this.workspace, this.logger, t, this.globalStorageUri);
        try {
          await manager.init();
        } catch (error) {
          messages.push(`Failed to initialize target manager: ${error}`);
          return null;
        }
        const listenerDisposable = manager.onRebuilt(() => {
          this.reloadIntervalQueue.push(this);
        });
        return {
          manager,
          listenerDisposable: listenerDisposable,
        } as TargetUnit;
      }),
    );

    // メッセージを更新
    this.settingDiags.set(this.getSettingPath(settingFile), this.toDiags(settingFile, messages));
    this.managers.set(
      this.getSettingPath(settingFile),
      managers.filter((m) => m !== null),
    );
  }

  /**
   * 読込完了イベントの購読を開始する
   * @param listener イベントリスナー
   * @returns Disposable オブジェクト
   */
  onReloaded(listener: (s: L10nService) => any): Disposable {
    this.reloadedEmitter.on("reloaded", listener);
    return {
      dispose: () => {
        try {
          // Node 10+ supports off()
          (this.reloadedEmitter as any).off?.("reloaded", listener);
          // fallback
          this.reloadedEmitter.removeListener("reloaded", listener as any);
        } catch (err) {
          this.logger.warn("L10nService.onReloaded.dispose failed", err);
        }
      },
    };
  }

  getDiagnostics(): { diags: Map<string, MyDiagnostic[]>; statuses: string[] } {
    const diagsMap: Map<string, MyDiagnostic[]> = new Map();
    const statuses: string[] = [];

    // First, include any diagnostics/statuses that were produced while parsing settings
    const processedSettings = new Set<string>();
    for (const [settingPath, settingDiag] of this.settingDiags.entries()) {
      processedSettings.add(settingPath);
      if (settingDiag.type === "diagnostic") {
        const mngDiag = settingDiag.diagnostics;
        const settingUri = mngDiag.uri;
        const key = settingUri.path;
        if (!diagsMap.has(key)) {
          diagsMap.set(key, []);
        }
        diagsMap.get(key)?.push(...mngDiag.diagnostics);
      } else if (settingDiag.type === "status") {
        statuses.push(...settingDiag.messages);
      }
    }

    // Then, include diagnostics collected from managers (l10n files)
    for (const [settingFile, tgtUnits] of this.managers.entries()) {
      for (const tu of tgtUnits) {
        // 1) include diagnostics from parsed translation files
        {
          const entries = tu.manager?.l10ns ? Array.from(tu.manager.l10ns.entries()) : [];
          for (const [l10nUri, res] of entries) {
            const key = l10nUri;
            if (!diagsMap.has(key)) {
              diagsMap.set(key, []);
            }
            for (const diag of res.diagnostics) {
              diagsMap.get(key)?.push(diag);
            }
          }
        }

        // 2) include diagnostics produced by matching code <-> translations
        try {
          const matchItems = tu.manager?.getMatchDiagnostics() || [];
          for (const item of matchItems) {
            const uri = item.uri;
            const key = uri.path;
            const arr = item.diagnostics || [];
            if (!diagsMap.has(key)) {
              diagsMap.set(key, []);
            }
            diagsMap.get(key)?.push(...arr);
          }
        } catch (err) {
          this.logger.warn("L10nService.getDiagnostics: matching diagnostics failed", err);
        }
      }
      // ensure settings without managers but with diagnostics were already added above
      processedSettings.add(settingFile);
    }

    return { diags: diagsMap, statuses };
  }

  /**
   * コード/翻訳ファイル上の位置からキーを取得する
   * @param uri
   * @param position
   * @returns
   */
  public getKeyAtPosition(uri: URI, position: MyPosition): string | null {
    const path = uri.path;
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        // 1) コード内の l10n 呼び出しをチェック
        const codes = tu.manager?.codes;
        if (codes && codes.has(path)) {
          const list = codes.get(path) || [];
          for (const c of list) {
            if (this.positionInRange(position, c.location.range)) {
              return c.key;
            }
          }
        }

        // 2) 翻訳ファイル (.po 等) の msgid 範囲をチェック
        const l10ns = tu.manager?.l10ns;
        if (l10ns && l10ns.has(path)) {
          const parsed = l10ns.get(path);
          const langs = Object.keys(parsed?.entries || {});
          for (const lang of langs) {
            const entries = (parsed!.entries as any)[lang] || {};
            for (const k of Object.keys(entries)) {
              const entry = entries[k];
              if (entry && entry.location && this.positionInRange(position, entry.location.range)) {
                return k;
              }
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 指定されたキーに対する翻訳エントリをすべて取得する
   * @param key
   * @returns L10nEntry の配列
   */
  public findTranslationEntriesForKey(key: string): L10nEntry[] {
    const result: L10nEntry[] = [];
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const l10ns = tu.manager?.l10ns;
        if (!l10ns) {
          continue;
        }
        for (const [, parsed] of l10ns.entries()) {
          const langs = Object.keys(parsed?.entries || {});
          for (const lang of langs) {
            const entries = parsed!.entries[lang] || {};
            if (entries[key]) {
              result.push(entries[key]);
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * 指定されたキーに対する翻訳（テキスト + ファイル情報）を取得する
   * - Hover や他の UI 用に翻訳文字列と出所ファイル名 / パス / 言語を返す
   */
  public getTranslationsForKey(
    key: string,
  ): { translation: string; uri: URI; fileName: string; path: string; lang: string; location?: MyLocation }[] {
    const result: {
      translation: string;
      uri: URI;
      fileName: string;
      path: string;
      lang: string;
      location?: MyLocation;
    }[] = [];
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const l10ns = tu.manager?.l10ns;
        if (!l10ns) {
          continue;
        }
        for (const [l10nUri, parsed] of l10ns.entries()) {
          const langs = Object.keys(parsed?.entries || {});
          for (const lang of langs) {
            const entries = (parsed!.entries as any)[lang] || {};
            if (entries[key] && typeof entries[key].translation === "string") {
              const uriObj = URI.parse(l10nUri);
              const fileName = uriObj.path.split("/").pop() || l10nUri;
              result.push({
                translation: entries[key].translation,
                uri: uriObj,
                fileName,
                path: uriObj.path,
                lang,
                location: entries[key].location,
              });
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Return a deduplicated list of all known localization file URIs (parsed by TranslationManager).
   * Used by providers that need to add/remove entries across all translation files.
   */
  public getAllL10nUris(): URI[] {
    const seen = new Set<string>();
    const result: URI[] = [];
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const l10ns = tu.manager?.l10ns;
        if (!l10ns) {
          continue;
        }
        for (const [luri] of l10ns.entries()) {
          if (!seen.has(luri)) {
            seen.add(luri);
            result.push(URI.parse(luri));
          }
        }
      }
    }
    return result;
  }

  /**
   * Compute insertion targets for adding a new translation `key` corresponding to a
   * code location (uri + position).  For each known localization file return the
   * MyPosition where the new entry text should be inserted and the formatted
   * entry text (using the file's parser.formatEntry).
   *
   * Behavior:
   * - Find the nearest localization call in the same code file that occurs before
   *   `position` and has an existing translation entry; insert the new entry
   *   directly under that existing entry in each translation file where it
   *   appears.
   * - If no such preceding code-localization key is found, use the last
   *   occurring entry in the translation file as the insertion anchor.
   * - If the file has no entries, insertion position will be at EOF (document
   *   end).
   */
  public computeInsertionTargetsForKeyAt(
    codeUri: URI,
    position: MyPosition,
    key: string,
    translation: string | null = null,
  ): { uri: URI; position: MyPosition; entryText: string }[] {
    if (!key) {
      return [];
    }

    // 1) find nearest preceding code localization call (in same file) that has translations
    const path = codeUri.path;
    type CodeCandidate = { key: string; startLine: number; startChar: number };
    const candidates: CodeCandidate[] = [];

    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const codes = tu.manager?.codes;
        if (!codes) {
          continue;
        }
        if (!codes.has(path)) {
          continue;
        }
        const list = codes.get(path) || [];
        for (const c of list) {
          const r = c.location.range;
          // only consider calls that occur at-or-before the position
          // and which themselves have at least one translation entry
          if (
            r.start.line < position.line ||
            (r.start.line === position.line && r.start.character <= position.character)
          ) {
            const transEntries = this.findTranslationEntriesForKey(c.key) || [];
            if (transEntries.length > 0) {
              candidates.push({ key: c.key, startLine: r.start.line, startChar: r.start.character });
            }
          }
        }
      }
    }

    // choose the closest candidate by position (largest startLine/startChar)
    candidates.sort((a, b) => b.startLine - a.startLine || b.startChar - a.startChar);
    const nearestKey = candidates.length > 0 ? candidates[0].key : null;
    // DEBUG: log nearestKey and candidate list when running tests (removed after verification)
    try {
      (this.logger as any)?.info?.(
        `computeInsertionTargetsForKeyAt: nearestKey=${nearestKey}, candidates=[${candidates.map((c) => c.key).join(",")}]`,
      );
    } catch (err) {
      // ignore logging errors in environments without logger
    }
    // also emit to stdout during tests for easier inspection
    try {
      console.log(
        `computeInsertionTargetsForKeyAt: nearestKey=${nearestKey}, candidates=[${candidates.map((c) => c.key).join(",")}]`,
      );
    } catch (err) {}

    const l10nUris = this.getAllL10nUris();
    const results: { uri: URI; position: MyPosition; entryText: string }[] = [];

    for (const uri of l10nUris) {
      // obtain the parsed TranslationParseResult for this uri
      let parsed: any = null;
      for (const tgtUnits of this.managers.values()) {
        for (const tu of tgtUnits) {
          const l10ns = tu.manager?.l10ns;
          if (l10ns && l10ns.has((uri as any).path)) {
            parsed = l10ns.get((uri as any).path);
            break;
          }
        }
        if (parsed) {
          break;
        }
      }

      // fallback: insert at EOF when parser not available
      if (!parsed) {
        results.push({
          uri: uri as URI,
          position: { line: Number.MAX_SAFE_INTEGER, character: 0 },
          entryText: `${key}\n`,
        });
        continue;
      }

      // determine language block inside parsed.entries (po parser uses filename->lang)
      const langs = Object.keys(parsed.entries || {});
      const lang = langs.length > 0 ? langs[0] : "";
      const entries = (parsed.entries || {})[lang] || {};

      // helper to format entry text for this file
      const entryText = parsed.formatEntry
        ? parsed.formatEntry(key, translation ?? key)
        : `msgid "${key}"\nmsgstr "${translation ?? key}"\n\n`;

      // if nearestKey exists and this file contains that key, insert after that entry
      if (nearestKey && entries[nearestKey]) {
        const e = entries[nearestKey] as any;
        const insPos = e.deletionRange ? e.deletionRange.end : e.location.range.end;
        results.push({
          uri: URI.parse((uri as any).toString()),
          position: { line: insPos.line, character: insPos.character || 0 },
          entryText,
        });
        continue;
      }

      // otherwise insert after the last existing entry in this file (if any)
      let lastEntry: any = null;
      let lastLine = -1;
      for (const k of Object.keys(entries)) {
        const ent = entries[k];
        const endLine = ent.deletionRange ? ent.deletionRange.end.line : ent.location.range.end.line;
        if (endLine > lastLine) {
          lastLine = endLine;
          lastEntry = ent;
        }
      }

      if (lastEntry) {
        const pos = lastEntry.deletionRange ? lastEntry.deletionRange.end : lastEntry.location.range.end;
        results.push({
          uri: URI.parse((uri as any).toString()),
          position: { line: pos.line, character: pos.character || 0 },
          entryText,
        });
        continue;
      }

      // no existing entries -> append at EOF
      results.push({
        uri: URI.parse((uri as any).toString()),
        position: { line: Number.MAX_SAFE_INTEGER, character: 0 },
        entryText,
      });
    }

    return results;
  }

  /**
   * Return a deduplicated, sorted list of all known localization keys
   * collected from both parsed code occurrences and translation files.
   */
  public getAllKeys(): string[] {
    const set = new Set<string>();
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        // collect keys from code fragments
        const codes = tu.manager?.codes;
        if (codes) {
          for (const [, list] of codes.entries()) {
            for (const c of list) {
              if (c && c.key) {
                set.add(c.key);
              }
            }
          }
        }

        // collect keys from translation files
        const l10ns = tu.manager?.l10ns;
        if (l10ns) {
          for (const [, parsed] of l10ns.entries()) {
            const langs = Object.keys(parsed?.entries || {});
            for (const lang of langs) {
              const entries = (parsed!.entries as any)[lang] || {};
              for (const k of Object.keys(entries)) {
                set.add(k);
              }
            }
          }
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Aggregate configured localization function names across all targets.
   * Used by the CompletionProvider to detect invocation sites.
   */
  public getAllFuncNames(): string[] {
    const set = new Set<string>();
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const fns = (tu.manager?.target && tu.manager?.target.l10nFuncNames) || [];
        for (const f of fns) {
          if (f && f.trim()) {
            set.add(f.trim());
          }
        }
      }
    }
    return Array.from(set);
  }

  /**
   * Return completion candidates (fuzzy-scored + translations) for a given prefix.
   */
  public getCompletionCandidates(
    prefix: string,
    maxResults: number = 200,
  ): {
    key: string;
    score: number;
    translations: {
      translation: string;
      uri: URI;
      fileName: string;
      path: string;
      lang: string;
      location?: MyLocation;
    }[];
  }[] {
    const allKeys = this.getAllKeys() || [];
    const pat = (prefix || "").toLowerCase();

    const fuzzyScore = (pat: string, str: string): number => {
      if (!pat) {
        return 1000;
      } // empty pattern — highest score
      pat = pat.toLowerCase();
      str = str.toLowerCase();
      let pi = 0;
      let si = 0;
      let score = 0;
      let consec = 0;
      let firstMatch = -1;
      while (pi < pat.length && si < str.length) {
        if (pat[pi] === str[si]) {
          if (firstMatch === -1) {
            firstMatch = si;
          }
          score += 100;
          if (consec > 0) {
            score += 30 * consec;
          }
          if (si === 0) {
            score += 50;
          }
          consec += 1;
          pi += 1;
          si += 1;
        } else {
          consec = 0;
          si += 1;
        }
      }
      if (pi < pat.length) {
        return -Infinity;
      } // not a subsequence
      const gapPenalty = firstMatch >= 0 ? firstMatch : 0;
      const lengthPenalty = Math.max(0, str.length - pat.length);
      return score - gapPenalty - Math.floor(lengthPenalty / 2);
    };

    const scored: { key: string; score: number }[] = [];
    for (const k of allKeys) {
      const s = fuzzyScore(pat, k);
      if (s !== -Infinity) {
        scored.push({ key: k, score: s });
      }
    }

    if (scored.length === 0) {
      return [];
    }

    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const top = scored.slice(0, maxResults);

    return top.map((s) => ({ key: s.key, score: s.score, translations: this.getTranslationsForKey(s.key) }));
  }

  /**
   * Find an inner range inside a literal/PO fragment.
   * Returns offsets relative to the provided `fullText` (or null).
   */
  public findInnerRangeInText(fullText: string, key: string): { start: number; end: number } | null {
    if (!fullText) {
      return null;
    }
    // try to locate the raw key text inside the literal/po range
    const idx = fullText.indexOf(key);
    if (idx >= 0) {
      return { start: idx, end: idx + key.length };
    }

    // fallback: find first/last quote and return inner area
    const firstQuote = fullText.search(/['"`]/);
    if (firstQuote >= 0) {
      const quoteChar = fullText[firstQuote];
      const lastQuote = fullText.lastIndexOf(quoteChar);
      if (lastQuote > firstQuote) {
        return { start: firstQuote + 1, end: lastQuote };
      }
    }

    return null;
  }

  /**
   * Escape a string for safe insertion into a .po msgid quoted string.
   */
  public escapePoString(s: string): string {
    if (s === null || s === undefined) {
      return "";
    }
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }

  public findCodeReferencesForKey(key: string) {
    const result: any[] = [];
    for (const tgtUnits of this.managers.values()) {
      for (const tu of tgtUnits) {
        const codes = tu.manager?.codes;
        if (!codes) {
          continue;
        }
        for (const [, list] of codes.entries()) {
          for (const c of list) {
            if (c.key === key && c.location) {
              result.push(c.location);
            }
          }
        }
      }
    }
    return result as MyLocation[];
  }

  // New: collect rename targets for a key located at the given location
  public collectEntriesForKeyAt(
    uri: URI,
    position: MyPosition,
  ): { key: string; codeLocations: MyLocation[]; translationEntries: L10nEntry[] } | null {
    const key = this.getKeyAtPosition(uri, position);
    if (!key) {
      return null;
    }
    return {
      key,
      codeLocations: this.findCodeReferencesForKey(key),
      translationEntries: this.findTranslationEntriesForKey(key),
    };
  }

  // New: check whether renaming `oldKey` to `newKey` is allowed (no translation collisions)
  public canRenameKey(oldKey: string, newKey: string): { ok: boolean; conflicts: L10nEntry[] } {
    if (!oldKey || !newKey) {
      return { ok: false, conflicts: [] };
    }
    if (oldKey === newKey) {
      return { ok: true, conflicts: [] };
    }
    const conflicts = this.findTranslationEntriesForKey(newKey) || [];
    return { ok: conflicts.length === 0, conflicts };
  }

  public findDefinition(uri: URI, position: MyPosition): MyLocation[] {
    const key = this.getKeyAtPosition(uri, position);
    if (!key) {
      return [];
    }
    return this.findTranslationEntriesForKey(key).map((e) => e.location);
  }

  public findReferences(uri: URI, position: MyPosition): MyLocation[] {
    const key = this.getKeyAtPosition(uri, position);
    if (!key) {
      return [];
    }
    return this.findCodeReferencesForKey(key);
  }

  private positionInRange(pos: MyPosition, range: MyRange): boolean {
    if (!range) {
      return false;
    }
    if (pos.line < range.start.line || pos.line > range.end.line) {
      return false;
    }
    if (pos.line === range.start.line && pos.character < range.start.character) {
      return false;
    }
    if (pos.line === range.end.line && pos.character > range.end.character) {
      return false;
    }
    return true;
  }

  /**
   * メッセージを登録する。ファイルの結果は診断へ送り、vscode設定の結果はステータスへ送られる。
   * @param settingFile ローカライズ設定の Uri または workspace folder index
   * @param messages メッセージの配列
   */
  private toDiags(settingFile: number | URI, messages: string[]): DiagOrStatus {
    let isConfig = typeof settingFile === "number";
    const settingName = this.getSettingName(settingFile);
    if (isConfig) {
      return {
        type: "status",
        messages: messages.length > 0 ? [`Invalid settings in ${settingName}:`, ...messages.map((m) => `- ${m}`)] : [],
      };
    } else {
      return {
        type: "diagnostic",
        diagnostics: {
          uri: settingFile as URI,
          diagnostics: messages.map((m) => {
            return {
              // 設定jsonのパースエラーのため位置特定不可
              range: {
                start: { line: 0, character: 0 } as MyPosition,
                end: { line: 0, character: 0 },
              } as MyRange,
              message: m,
              severity: MyDiagnosticSeverity.Warning,
              code: DiagnosticsCode.settingsInvalid,
            } as MyDiagnostic;
          }),
        },
      };
    }
  }

  /**
   * ローカライズ設定オブジェクトの正規化
   * @param rawTargets 設定オブジェクトの配列
   * @param settingFile 設定ファイルの Uri または workspace folder index
   * @returns 正規化されたターゲット配列とエラーメッセージの配列
   */
  async normalizeSettingsObject(
    rawTargets: any[],
    settingFile: URI | number,
  ): Promise<{ targets: L10nTarget[]; messages: string[] }> {
    const isConfig = typeof settingFile === "number";
    const rootPropName = isConfig ? "localize-support.targets" : "targets";
    if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
      // ターゲットがない、またはいずれかの配列が空でチェック不要な場合は空オブジェクトを返す
      return {
        targets: [],
        messages: isConfig ? [] : [`No targets defined. Please define at least one target.`],
      };
    }

    const targets: L10nTarget[] = [];
    const messages: string[] = [];
    for (let i = 0; i < rawTargets.length; i++) {
      const targetObj = rawTargets[i];
      if (typeof targetObj !== "object" || targetObj === null) {
        messages.push(`${rootPropName}[${i}]: Invalid target definition. Expected an object.`);
        targets.push(this.createEmptyTarget(settingFile));
        continue;
      }

      if (
        this.isEmptyOrNullArrayProperty(targetObj, "codeLanguages") ||
        this.isEmptyOrNullArrayProperty(targetObj, "codeDirs") ||
        this.isEmptyOrNullArrayProperty(targetObj, "l10nDirs") ||
        this.isEmptyOrNullArrayProperty(targetObj, "l10nFuncNames")
      ) {
        targets.push(this.createEmptyTarget(settingFile));
        messages.push(
          `${rootPropName}[${i}]: Incomplete target definition. Please ensure codeLanguages, codeDirs, l10nDirs, and l10nFuncNames are all specified.`,
        );
        continue;
      }

      const codeLanguages: CodeLanguage[] = [];
      for (const lang of targetObj.codeLanguages) {
        if (CodeLanguages.includes(lang)) {
          if (!codeLanguages.includes(lang)) {
            codeLanguages.push(lang);
          }
        } else {
          const langsStr = CodeLanguages.map((l) => `'${l}'`).join(", ");
          messages.push(
            `${rootPropName}[${i}]: Invalid code language '${lang}'. Supported languages are: ${langsStr}.`,
          );
        }
      }

      const codeDirs: URI[] = [];
      // normalize codeDirs in parallel
      const normalizedCodeDirs = await Promise.all(
        (targetObj.codeDirs || []).map((d: any) => normalizeDirPath(this.workspace, settingFile, d)),
      );
      normalizedCodeDirs.forEach((normalized, idx) => {
        const dir = targetObj.codeDirs[idx];
        if (normalized) {
          if (!codeDirs.find((d) => d.path === normalized.path)) {
            codeDirs.push(normalized);
          }
        } else {
          messages.push(`${rootPropName}[${i}]: Code directory '${dir}' does not exist.`);
        }
      });

      const l10nDirs: URI[] = [];
      // normalize l10nDirs in parallel
      const normalizedL10nDirs = await Promise.all(
        (targetObj.l10nDirs || []).map((d: any) => normalizeDirPath(this.workspace, settingFile, d)),
      );
      normalizedL10nDirs.forEach((normalized, idx) => {
        const dir = targetObj.l10nDirs[idx];
        if (normalized) {
          if (!l10nDirs.find((d) => d.path === normalized.path)) {
            l10nDirs.push(normalized);
          }
        } else {
          messages.push(`${rootPropName}[${i}]: Localization directory '${dir}' does not exist.`);
        }
      });

      const l10nFuncNames: string[] = [];
      for (const funcName of targetObj.l10nFuncNames) {
        if (typeof funcName === "string") {
          const trimmed = funcName.trim();
          if (trimmed.length > 0) {
            if (!l10nFuncNames.includes(trimmed)) {
              l10nFuncNames.push(trimmed);
            }
          }
        }
      }

      let l10nFormat: L10nFormat;
      if (Object.prototype.hasOwnProperty.call(targetObj, "l10nFormat") && L10nFormats.includes(targetObj.l10nFormat)) {
        l10nFormat = targetObj.l10nFormat;
      } else {
        l10nFormat = "po";
        const formatsStr = L10nFormats.map((f) => `'${f}'`).join(", ");
        messages.push(
          `${rootPropName}[${i}]: Invalid or missing l10nFormat. Defaulting to 'po'. Supported formats are: ${formatsStr}.`,
        );
      }

      let l10nExtension: string;
      if (
        Object.prototype.hasOwnProperty.call(targetObj, "l10nExtension") &&
        targetObj.l10nExtension &&
        typeof targetObj.l10nExtension === "string" &&
        targetObj.l10nExtension.trim().length > 0
      ) {
        const extension = targetObj.l10nExtension.trim();
        l10nExtension = extension.includes(".") ? extension : `.${extension}`;
      } else {
        l10nExtension = ".po";
        messages.push(`${rootPropName}[${i}]: Invalid or missing l10nExtension. Defaulting to '.po'.`);
      }

      targets.push({
        codeLanguages: codeLanguages,
        codeDirs: codeDirs,
        l10nFormat: l10nFormat,
        l10nDirs: l10nDirs,
        l10nExtension: l10nExtension,
        l10nFuncNames: l10nFuncNames,
        settingsLocation: settingFile,
      } as L10nTarget);
    }
    return { targets, messages };
  }

  /**
   * 設定ファイルの名前を取得
   * localize-support.json のパス、または workspace folder 名
   * @param settingFile localize-support.json の Uri または workspace folder index
   * @returns 設定ファイルの名前
   */
  private getSettingName(settingFile: number | URI) {
    let settingName: string = "<unknown>";
    // concrete localize-support.json file
    if (typeof settingFile !== "number") {
      settingName = settingFile.path;
    } else {
      // settings.json in user / workspace settings
      const wsfs = this.workspace.getWorkspaceFolders();
      if (wsfs && settingFile < wsfs.length) {
        settingName = `workspace(${wsfs[settingFile].name}) settings`;
      }
    }
    return settingName;
  }

  /**
   * 設定ファイルの名前を取得
   * localize-support.json のパス、または workspace folder 名
   * @param settingFile localize-support.json の Uri または workspace folder index
   * @returns 設定ファイルの名前
   */
  private getSettingPath(settingFile: number | URI) {
    let path: string = "<unknown>";
    // concrete localize-support.json file
    if (typeof settingFile !== "number") {
      path = settingFile.path;
    } else {
      // settings.json in user / workspace settings
      const wsfs = this.workspace.getWorkspaceFolders();
      if (wsfs && settingFile < wsfs.length) {
        path = wsfs[settingFile].uri.path;
      }
    }
    return path;
  }

  /**
   * 指定されたプロパティが存在しない、または空の配列であるかを確認する
   * @param obj オブジェクト
   * @param propName プロパティ名
   * @returns 存在しない、または空の配列である場合は true、それ以外は false
   */
  private isEmptyOrNullArrayProperty(obj: any, propName: string): boolean {
    return (
      !Object.prototype.hasOwnProperty.call(obj, propName) ||
      !Array.isArray(obj[propName]) ||
      obj[propName].length === 0
    );
  }

  /**
   * 空の L10nTarget オブジェクトを作成する
   * @param settingFile 設定ファイルの Uri または workspace folder index
   * @returns 空の L10nTarget オブジェクト
   */
  private createEmptyTarget(settingFile: URI | number): L10nTarget {
    return {
      codeLanguages: [],
      codeDirs: [],
      l10nFormat: "po",
      l10nDirs: [],
      l10nExtension: ".po",
      l10nFuncNames: [],
      settingsLocation: settingFile,
    };
  }
}
