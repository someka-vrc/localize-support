import * as assert from "assert";
import { URI } from "vscode-uri";
import { vscTypeHelper } from "../../../models/vscTypes";
import { myLocationToPlain, myLocationsToPlain } from "../../../providers/providerUtil";

suite("Provider util (unit)", () => {
  test("myLocationToPlain() and myLocationsToPlain() should convert MyLocation to plain serializable object", () => {
    const en = URI.file("d:/proj/locales/en.po");
    const entryLoc = vscTypeHelper.newLocation(en, vscTypeHelper.newRange(1, 0, 1, 5));

    const plain = myLocationToPlain(entryLoc as any);
    assert.strictEqual(plain.uri, en.toString());
    assert.deepStrictEqual(plain.range, entryLoc.range);

    const arr = myLocationsToPlain([entryLoc as any]);
    assert.strictEqual(arr.length, 1);
    assert.strictEqual(arr[0].uri, en.toString());
  });
});
