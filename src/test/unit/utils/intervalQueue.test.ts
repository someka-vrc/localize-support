import assert from "assert";
import { IntervalQueue, OrganizeStrategies } from "../../../utils/intervalQueue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite("IntervalQueue", () => {
  test("processes pushed items in order", async () => {
    const processed: number[] = [];
    const q = new IntervalQueue<number>(10, async (n) => {
      processed.push(n);
    });
    q.start();

    q.push(1);
    q.push(2);

    await sleep(80);
    q.dispose();

    assert.deepStrictEqual(processed, [1, 2]);
  });

  test("lastOnly strategy keeps only last item", async () => {
    const processed: number[] = [];
    const q = new IntervalQueue<number>(10, async (n) => {
      processed.push(n);
    }, OrganizeStrategies.lastOnly);
    q.start();

    q.push(1);
    q.push(2);
    q.push(3);

    await sleep(80);
    q.dispose();

    assert.deepStrictEqual(processed, [3]);
  });

  test("skipDuplicatesByKey skips older duplicates (keeps latest)", async () => {
    const processedIds: number[] = [];
    type Item = { id: number; key: string };

    const q = new IntervalQueue<Item>(10, async (it) => {
      processedIds.push(it.id);
    }, OrganizeStrategies.skipDuplicatesByKey((it) => it.key));
    q.start();

    q.push({ id: 1, key: "a" });
    q.push({ id: 2, key: "a" });
    q.push({ id: 3, key: "b" });

    await sleep(80);
    q.dispose();

    // per implementation, the latest occurrence is kept and older duplicates are skipped
    assert.deepStrictEqual(processedIds, [2, 3]);
  });

  test("errors in processItem are caught and processing continues", async () => {
    const processed: number[] = [];
    const errors: any[] = [];

    // stub console.error
    const origConsoleError = console.error;
    console.error = (...args: any[]) => {
      errors.push(args);
    };

    const q = new IntervalQueue<number>(10, async (n) => {
      if (n === 2) {
        throw new Error("fail");
      }
      processed.push(n);
    });
    q.start();

    q.push(1);
    q.push(2);
    q.push(3);

    await sleep(120);
    q.dispose();

    // restore
    console.error = origConsoleError;

    assert.deepStrictEqual(processed, [1, 3]);
    assert.ok(errors.length > 0, "console.error should be called on processing error");
    assert.ok(
      errors.some((args) => String(args[0]).includes("IntervalQueue item processing failed")),
      "console.error should include IntervalQueue failure message",
    );
  });

  test("processes falsy number 0", async () => {
    const processed: number[] = [];
    const q = new IntervalQueue<number>(10, async (n) => {
      processed.push(n);
    });
    q.start();

    q.push(0);
    q.push(1);

    await sleep(80);
    q.dispose();

    assert.deepStrictEqual(processed, [0, 1]);
  });

  test("processes falsy values empty string and false", async () => {
    const processed: Array<string | boolean> = [];
    const q = new IntervalQueue<string | boolean>(10, async (v) => {
      processed.push(v);
    });
    q.start();

    q.push('');
    q.push(false);
    q.push('ok');

    await sleep(80);
    q.dispose();

    assert.deepStrictEqual(processed, ['', false, 'ok']);
  });

  test("dispose clears queue and stops further processing", async () => {
    const processed: number[] = [];
    const q = new IntervalQueue<number>(20, async (n) => {
      processed.push(n);
    });
    q.start();

    q.push(1);
    q.dispose();

    // pushing after dispose should not cause processing
    q.push(2);

    await sleep(120);

    assert.deepStrictEqual(processed, []);
  });

  test("items pushed during processing are processed in subsequent cycles", async () => {
    const processed: number[] = [];
    let q!: IntervalQueue<number>;

    q = new IntervalQueue<number>(20, async (n) => {
      processed.push(n);
      // when processing first item, push another one for the next cycle
      if (n === 1) {
        q.push(2);
      }
    });
    q.start();

    q.push(1);

    await sleep(200);
    q.dispose();

    assert.deepStrictEqual(processed, [1, 2]);
  });
});
