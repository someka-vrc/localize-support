import assert from "assert";
import { Debounce } from "../../../utils/debounce";

suite("debounce", () => {
  test("calls only once after wait", async () => {
    let count = 0;
    const fn = () => {
      count++;
    };

    const deb = new Debounce(fn, 50);
    deb.trigger();
    deb.trigger();
    deb.trigger();

    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(count, 1);
  });

  test("passes arguments and this", async () => {
    const obj = {
      val: 0,
      inc(this: any, n: number) {
        this.val += n;
      },
    };

    const deb = new Debounce(obj.inc, 50);
    deb.call(obj, 3);

    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(obj.val, 3);
  });
});
