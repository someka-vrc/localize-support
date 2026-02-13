export class Debounce<T extends (...args: any[]) => any> {
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private fn: T, private wait = 0) {}

  /**
   * トリガー。wait時間が経過するまでfnの呼び出しを遅延させる。  
   * 処理内部で this はundefinedになることに注意。thisを指定したい場合はcall()を使用すること。
   * @param args 
   */
  trigger(...args: Parameters<T>) {
    const ctx = undefined;
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn.apply(ctx as any, args);
    }, this.wait);
  }

  /**
   * thisArgを指定して呼び出すバージョン。通常の関数呼び出しのようにthisを指定して呼び出したい場合はこちらを使用する。
   * @param thisArg thisに指定する値
   * @param args 
   */
  call(thisArg: unknown, ...args: Parameters<T>) {
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn.apply(thisArg as any, args);
    }, this.wait);
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
