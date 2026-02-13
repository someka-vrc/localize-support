import {
  MyDisposable,
  MyDiagnostic,
  MyRange,
  MyPosition,
  MyDiagnosticSeverity,
  IWorkspaceService,
} from "../models/vscTypes";
import { URI } from "vscode-uri";
import type { DiagOrStatus } from "../models/interfaces";
import {
  CodeLanguage,
  CodeLanguages,
  L10nFormat,
  L10nFormats,
  L10nTarget,
} from "../models/l10nTypes";
import { L10nTargetManager } from "./l10nTargetManager";
import { IntervalQueue, OrganizeStrategies } from "../utils/intervalQueue";
import { EventEmitter } from "events";
import { normalizeDirPath } from "../utils/util";

type TargetUnit = {
  manager?: L10nTargetManager;
  listenerDisposable?: MyDisposable;
};
/**
 * ローカライズサービス
 *
 * ローカライズ設定ファイルを監視し、ローカライズターゲットを管理する。
 */
export class L10nService implements MyDisposable {
  private readonly settingsWatchers: MyDisposable[] = [];
  private readonly managers: Map<string, TargetUnit[]> = new Map();
  private readonly settingDiags: Map<string, DiagOrStatus> = new Map();
  private readonly reloadIntervalQueue: IntervalQueue<L10nService>;

  private readonly reloadedEmitter = new EventEmitter();

  constructor(
    private workspace: IWorkspaceService,
    reloadIntervalMs: number = 500,
  ) {
    this.reloadIntervalQueue = new IntervalQueue<L10nService>(
      reloadIntervalMs,
      async (thisArg) => {
        thisArg.reloadedEmitter.emit("reloaded", thisArg);
      },
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
    const fsWatcher = this.workspace.createFileSystemWatcher(
      settingsGlob,
      async (type, uri) => {
        if (type === "changed" || type === "created") {
          await this.reload(uri);
        } else if (type === "deleted") {
          await this.unload(uri);
        }
      },
    );
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
    let rawTargets: any[] = [];
    let isConfig = typeof settingFile === "number";

    // 既存のマネージャーを破棄
    await this.disposeManagersBySetting(this.getSettingPath(settingFile));
    // 設定jsonの読み込み
    if (isConfig) {
      const folder =
        this.workspace.getWorkspaceFolders()![settingFile as number];
      const config = this.workspace.getConfiguration(
        "localize-support",
        folder.uri,
      );
      rawTargets = config.get<any[]>("targets") || [];
    } else {
      const buf = await this.workspace.readFile(settingFile as URI);
      const content = Buffer.from(buf).toString();
      let json: any;
      try {
        json = JSON.parse(content);
      } catch (error) {
        const diags = this.toDiags(settingFile, [`Invalid JSON: ${error}`]);
        this.settingDiags.set(this.getSettingPath(settingFile), diags);
        return;
      }
      rawTargets = json.targets || [];
    }

    // 設定オブジェクト化
    const { targets, messages } = await this.normalizeSettingsObject(
      rawTargets,
      settingFile,
    );
    // 新しいマネージャーを作成、登録
    const managers = await Promise.all(
      targets.map(async (t) => {
        const manager = new L10nTargetManager(this.workspace, t);
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
    this.settingDiags.set(
      this.getSettingPath(settingFile),
      this.toDiags(settingFile, messages),
    );
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
  onReloaded(listener: (s: L10nService) => any): MyDisposable {
    this.reloadedEmitter.on("reloaded", listener);
    return {
      dispose: () => {
        try {
          // Node 10+ supports off()
          (this.reloadedEmitter as any).off?.("reloaded", listener);
          // fallback
          this.reloadedEmitter.removeListener("reloaded", listener as any);
        } catch {}
      },
    } as MyDisposable;
  }

  getDiagnostics(): { diags: Map<URI, MyDiagnostic[]>; statuses: string[] } {
    const diagsMap: Map<URI, MyDiagnostic[]> = new Map();
    const statuses: string[] = [];
    for (const [settingFile, tgtUnits] of this.managers.entries()) {
      if (this.settingDiags.has(settingFile)) {
        const settingDiag = this.settingDiags.get(settingFile)!;
        if (settingDiag.type === "diagnostic") {
          const mngDiag = settingDiag.diagnostics;
          const settingUri = mngDiag.uri;
          if (!diagsMap.has(settingUri)) {
            diagsMap.set(settingUri, []);
          }
          diagsMap.get(settingUri)?.push(...mngDiag.diagnostics);
        } else if (settingDiag.type === "status") {
          statuses.push(...settingDiag.messages);
        } else {
          // do nothing
        }
      }
      for (const tu of tgtUnits) {
        for (const [l10nUri, res] of tu.manager?.l10ns.entries() || []) {
          if (!diagsMap.has(l10nUri)) {
            diagsMap.set(l10nUri, []);
          }
          for (const diag of res.diagnostics) {
            diagsMap.get(l10nUri)?.push(diag);
          }
        }
      }
    }
    return { diags: diagsMap, statuses };
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
        messages:
          messages.length > 0
            ? [
                `Invalid settings in ${settingName}:`,
                ...messages.map((m) => `- ${m}`),
              ]
            : [],
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
        messages: isConfig
          ? []
          : [`No targets defined. Please define at least one target.`],
      };
    }

    const targets: L10nTarget[] = [];
    const messages: string[] = [];
    for (let i = 0; i < rawTargets.length; i++) {
      const targetObj = rawTargets[i];
      if (typeof targetObj !== "object" || targetObj === null) {
        messages.push(
          `${rootPropName}[${i}]: Invalid target definition. Expected an object.`,
        );
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
      for (const dir of targetObj.codeDirs) {
        const normalized = await normalizeDirPath(
          this.workspace,
          settingFile,
          dir,
        );
        if (normalized) {
          if (!codeDirs.find((d) => d.path === normalized.path)) {
            codeDirs.push(normalized);
          }
        } else {
          messages.push(
            `${rootPropName}[${i}]: Code directory '${dir}' does not exist.`,
          );
        }
      }

      const l10nDirs: URI[] = [];
      for (const dir of targetObj.l10nDirs) {
        const normalized = await normalizeDirPath(
          this.workspace,
          settingFile,
          dir,
        );
        if (normalized) {
          if (!l10nDirs.find((d) => d.path === normalized.path)) {
            l10nDirs.push(normalized);
          }
        } else {
          messages.push(
            `${rootPropName}[${i}]: Localization directory '${dir}' does not exist.`,
          );
        }
      }

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
      if (
        Object.prototype.hasOwnProperty.call(targetObj, "l10nFormat") &&
        L10nFormats.includes(targetObj.l10nFormat)
      ) {
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
        messages.push(
          `${rootPropName}[${i}]: Invalid or missing l10nExtension. Defaulting to '.po'.`,
        );
      }

      targets.push({
        codeLanguages: codeLanguages,
        codeDirs: codeDirs,
        l10nFormat: l10nFormat,
        l10nDirs: l10nDirs,
        l10nExtension: l10nExtension,
        l10nFuncNames: l10nFuncNames,
        settingsLocation: settingFile,
        l10nEntries: {},
        codes: [],
        diagnostics: [],
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
      l10nEntries: {},
      codes: [],
      diagnostics: [],
    };
  }
}
