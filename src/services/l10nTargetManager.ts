import EventEmitter from "events";
import { L10nTarget } from "../models/l10nTypes";
import { IWorkspaceService, Disposable, MyDiagnostic, MyDiagnosticSeverity, vscTypeHelper } from "../models/vscTypes";
import { URI } from "vscode-uri";
import { TranslationManager } from "./translationManager";
import { CodeManager } from "./codeManager";
import { TranslationParseResult } from "./translationParser";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";

export class L10nTargetManager implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly l10nTranslationManager: TranslationManager;
  private readonly codeManager: CodeManager;
  private readonly rebuiltEmitter = new EventEmitter();
  private reloadIntervalQueue: IntervalQueue<string>;
  public get l10ns(): Map<string, TranslationParseResult> {
    return this.l10nTranslationManager.l10ns;
  }
  public get codes() {
    return this.codeManager.codes;
  }

  /**
   * コードと翻訳を突き合わせて診断を返す（配列版）
   * 戻り値: { uri, diagnostics }[] — 呼び出し側でマージしやすい形
   */
  public getMatchDiagnostics(): { uri: URI; diagnostics: MyDiagnostic[] }[] {
    const buckets = new Map<string, MyDiagnostic[]>();

    // collect used keys from code
    const usedKeys = new Set<string>();
    for (const [codeUri, codeList] of this.codes.entries()) {
      for (const c of codeList) {
        usedKeys.add(c.key);
      }
    }

    const pushDiagToBucket = (uriOrPath: URI | string, diag: MyDiagnostic) => {
      const key = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.path;
      const arr = buckets.get(key) || [];
      arr.push(diag);
      buckets.set(key, arr);
    };

    // build translation key index and language->uris map
    const keyExistsAnywhere = new Map<string, boolean>();
    const keyLangPresence = new Map<string, Set<string>>();
    const langToUris = new Map<string, string[]>();

    for (const [luri, res] of this.l10ns.entries()) {
      const luriPath = luri;
      for (const lang of Object.keys(res.entries || {})) {
        if (!langToUris.has(lang)) {
          langToUris.set(lang, []);
        }
        langToUris.get(lang)?.push(luriPath);

        const entries = (res.entries as any)[lang] || {};
        for (const k of Object.keys(entries)) {
          keyExistsAnywhere.set(k, true);
          if (!keyLangPresence.has(k)) {
            keyLangPresence.set(k, new Set());
          }
          keyLangPresence.get(k)?.add(lang);
        }
      }
    }

    // 1) 未定義キーの使用 (コード側)
    for (const [codeUri, codeList] of this.codes.entries()) {
      for (const c of codeList) {
        if (!keyExistsAnywhere.has(c.key)) {
          pushDiagToBucket(
            codeUri,
            vscTypeHelper.newDiagnostic(
              c.location.range,
              `Undefined localization key '${c.key}' used in code.`,
              MyDiagnosticSeverity.Warning,
            ),
          );
        }
      }
    }

    // 2) 未使用エントリ (翻訳側)
    for (const [luri, res] of this.l10ns.entries()) {
      const luriPath = luri;
      for (const lang of Object.keys(res.entries || {})) {
        const entries = (res.entries as any)[lang] || {};
        for (const [k, entry] of Object.entries(entries)) {
          if (!usedKeys.has(k)) {
            pushDiagToBucket(
              luriPath,
              vscTypeHelper.newDiagnostic(
                (entry as any).location.range,
                `Localization key '${k}' is not used in code.`,
                MyDiagnosticSeverity.Information,
              ),
            );
          }
        }
      }
    }

    // 3) 未翻訳言語あり
    const allLangs = Array.from(langToUris.keys());
    if (allLangs.length > 0) {
      for (const [k, langs] of keyLangPresence.entries()) {
        for (const lang of allLangs) {
          if (!langs.has(lang)) {
            const uris = langToUris.get(lang) || [];
            for (const uri of uris) {
              pushDiagToBucket(
                uri,
                vscTypeHelper.newDiagnostic(
                  vscTypeHelper.newRange(0, 0, 0, 0),
                  `Missing translation for key '${k}' in language '${lang}'.`,
                  MyDiagnosticSeverity.Warning,
                ),
              );
            }
          }
        }
      }
    }

    const result: { uri: URI; diagnostics: MyDiagnostic[] }[] = [];
    for (const [p, arr] of buckets.entries()) {
      // keys are file paths (string); construct a URI for the result
      const uriObj = URI.file(p);
      result.push({ uri: uriObj, diagnostics: arr });
    }

    return result;
  }

  constructor(
    private workspace: IWorkspaceService,
    public target: L10nTarget,
    reloadIntervalMs: number = 500,
  ) {
    this.l10nTranslationManager = new TranslationManager(this.workspace, this.target);
    const transDisposable = this.l10nTranslationManager.onRebuilt(() => this.reloadIntervalQueue.push("translation"));
    this.disposables.push(this.l10nTranslationManager, transDisposable);
    this.codeManager = new CodeManager(this.workspace, this.target);
    const codeDisposable = this.codeManager.onRebuilt(() => this.reloadIntervalQueue.push("code"));
    this.disposables.push(this.codeManager, codeDisposable);

    this.reloadIntervalQueue = new IntervalQueue<string>(
      reloadIntervalMs,
      async () => {
        this.rebuiltEmitter.emit("rebuilt");
      },
      this.workspace,
      OrganizeStrategies.skipDuplicatesByKey<string>((item) => item),
    );
    this.disposables.push(this.reloadIntervalQueue);
  }

  /**
   * 再構築完了イベントの購読を開始する
   * @param listener イベントリスナー
   * @returns MyDisposable オブジェクト
   */
  onRebuilt(listener: () => any): Disposable {
    this.rebuiltEmitter.on("rebuilt", listener);
    return {
      dispose: () => {
        try {
          // Node 10+ supports off()
          (this.rebuiltEmitter as any).off?.("rebuilt", listener);
          // fallback
          this.rebuiltEmitter.removeListener("rebuilt", listener as any);
        } catch (err) {
          this.workspace.logger.warn("L10nTargetManager.onRebuilt.dispose failed", err);
        }
      },
    };
  }

  public async init() {
    // initialize both translation and code managers
    await this.l10nTranslationManager.init();
    await this.codeManager.init();
    this.reloadIntervalQueue.start();
  }

  public dispose() {
    for (const disposable of this.disposables) {
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
