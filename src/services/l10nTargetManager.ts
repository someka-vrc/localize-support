import EventEmitter from "events";
import { L10nTarget } from "../models/l10nTypes";
import { IWorkspaceService, MyDisposable, MyDiagnostic, MyDiagnosticSeverity, vscTypeHelper } from "../models/vscTypes";
import { URI } from "vscode-uri";
import { TranslationManager } from "./translationManager";
import { CodeManager } from "./codeManager";
import { TranslationParseResult } from "./translationParser";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";

export class L10nTargetManager implements MyDisposable {
  private readonly disposables: MyDisposable[] = [];
  private readonly l10nTranslationManager: TranslationManager;
  private readonly codeManager: CodeManager;
  private readonly rebuiltEmitter = new EventEmitter();
  private reloadIntervalQueue: IntervalQueue<void>;
  public get l10ns(): Map<URI, TranslationParseResult> {
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

    const pushDiagToBucket = (uri: URI, diag: MyDiagnostic) => {
      const key = uri.path;
      const arr = buckets.get(key) || [];
      arr.push(diag);
      buckets.set(key, arr);
    };

    // build translation key index and language->uris map
    const keyExistsAnywhere = new Map<string, boolean>();
    const keyLangPresence = new Map<string, Set<string>>();
    const langToUris = new Map<string, URI[]>();

    for (const [luri, res] of this.l10ns.entries()) {
      for (const lang of Object.keys(res.entries || {})) {
        if (!langToUris.has(lang)) {
          langToUris.set(lang, []);
        }
        langToUris.get(lang)?.push(luri);

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
      for (const lang of Object.keys(res.entries || {})) {
        const entries = (res.entries as any)[lang] || {};
        for (const [k, entry] of Object.entries(entries)) {
          if (!usedKeys.has(k)) {
            pushDiagToBucket(
              luri,
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
      let uriObj: URI | undefined;
      for (const u of this.l10ns.keys()) {
        if (u.path === p) {
          uriObj = u;
          break;
        }
      }
      if (!uriObj) {
        for (const u of this.codes.keys()) {
          if (u.path === p) {
            uriObj = u;
            break;
          }
        }
      }
      if (uriObj) {
        result.push({ uri: uriObj, diagnostics: arr });
      }
    }

    return result;
  }

  constructor(
    private workspace: IWorkspaceService,
    public target: L10nTarget,
    reloadIntervalMs: number = 500,
  ) {
    this.l10nTranslationManager = new TranslationManager(
      this.workspace,
      this.target,
    );
    this.codeManager = new CodeManager(this.workspace, this.target);
    this.disposables.push(this.l10nTranslationManager);
    this.disposables.push(this.codeManager);

    this.reloadIntervalQueue = new IntervalQueue<void>(
      reloadIntervalMs,
      async () => {
        this.rebuiltEmitter.emit("rebuilt");
      },
      OrganizeStrategies.lastOnly,
    );
    this.disposables.push(this.reloadIntervalQueue);
  }

  /**
   * 再構築完了イベントの購読を開始する
   * @param listener イベントリスナー
   * @returns MyDisposable オブジェクト
   */
  onRebuilt(listener: () => any): MyDisposable {
    this.rebuiltEmitter.on("rebuilt", listener);
    return {
      dispose: () => {
        try {
          // Node 10+ supports off()
          (this.rebuiltEmitter as any).off?.("rebuilt", listener);
          // fallback
          this.rebuiltEmitter.removeListener("rebuilt", listener as any);
        } catch {}
      },
    } as MyDisposable;
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
