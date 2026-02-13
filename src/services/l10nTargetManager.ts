import EventEmitter from "events";
import { L10nTarget } from "../models/l10nTypes";
import { IWorkspaceService, MyDisposable } from "../models/vscTypes";
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
