import { Disposable } from "../models/vscTypes";

type SkippableItem<T> = {
  item: T;
  skip: boolean;
}
/**
 * 一定間隔でキュー内のアイテムをバッチ処理するクラス。
 *
 * 処理前にキューを整理することが可能（後に不要になるアイテムを削除したり、同種のアイテムをまとめたりなど）。
 */
export class IntervalQueue<T> implements Disposable {
  private items: T[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private disposed: boolean = false;
  private intervalMs: number;
  private processItem: (item: T) => Promise<void>;
  private organize: ((
    items: SkippableItem<T>[],
  ) => SkippableItem<T>[])[];
  /**
   * コンストラクタ
   *
   * @param intervalMs 処理間隔（ミリ秒）
   * @param processItem アイテム処理関数
   * @param organize アイテム整理関数
   */
  constructor(
    intervalMs: number,
    processItem: (item: T) => Promise<void>,
    ...organize: ((
      items: SkippableItem<T>[],
    ) => SkippableItem<T>[])[]
  ) {
    // プロパティへの代入
    this.intervalMs = intervalMs;
    this.processItem = processItem;
    this.organize = organize;
  }

  /** ストップ、破棄 */
  dispose() {
    this.disposed = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.items = [];
  }

  /** アイテムをキューに追加 */
  push(item: T) {
    this.items.push(item);
  }

  /** 処理開始 */
  public start(): void {
    if (this.timeoutId) {
      return;
    }
    void this.run();
  }

  /** ループ本体（内部用） */
  private async run() {
    if (this.timeoutId) {
      return;
    }
    while (!this.disposed) {
      if (this.items.length > 0) {
        let targets = [...this.items];
        this.items = [];
        for (const orgFunc of this.organize) {
          targets = orgFunc(targets.map((item) => ({ item, skip: false })))
            .filter((x) => !x.skip)
            .map((x) => x.item);
        }
        for (const item of targets) {
          if (item !== undefined && item !== null && !this.disposed) {
            try {
              await this.processItem(item);
            } catch (err) {
              console.error("IntervalQueue item processing failed:", err);
            }
          }
        }
      }
      if (this.disposed) {
        break;
      }
      await new Promise<void>((resolve) => {
        this.timeoutId = setTimeout(() => {
          this.timeoutId = null;
          resolve();
        }, this.intervalMs);
      });
    }
  }
}

export class OrganizeStrategies {
  /** 最後のアイテムのみを処理する戦略 */
  static lastOnly<T>(
    items: SkippableItem<T>[],
  ): SkippableItem<T>[] {
    return items.length > 0 ? [items[items.length - 1]] : [];
  }

  /** キーに基づいて重複するアイテムの古い方をスキップする戦略 */
  static skipDuplicatesByKey<T>(
    keyFunc: (item: T) => string,
  ): (items: SkippableItem<T>[]) => SkippableItem<T>[] {
    return (items) => {
      const seenKeys = new Set<string>();
      // mark older duplicates (keep the last occurrence)
      const result = items.map(({ item, skip }) => ({ item, skip }));
      for (let i = items.length - 1; i >= 0; i--) {
        const key = keyFunc(items[i].item);
        if (seenKeys.has(key)) {
          result[i].skip = true;
        } else {
          seenKeys.add(key);
        }
      }
      return result;
    };
  }
}