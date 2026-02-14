import * as assert from "assert";
import { URI } from "vscode-uri";
import { vscTypeHelper } from "../../../models/vscTypes";
import { myLocationsToPlain } from "../../../providers/providerUtil";

suite("Provider util (unit)", () => {
  test("myLocationsToPlain() should convert array of MyLocation to plain objects", () => {
    const codeUri = URI.file("d:/proj/src/foo.js");
    const codeLoc = vscTypeHelper.newLocation(codeUri, vscTypeHelper.newRange(0, 0, 0, 10));

    const arr = myLocationsToPlain([codeLoc as any]);
    assert.strictEqual(arr.length, 1);
    assert.strictEqual(arr[0].uri, codeUri.toString());
    assert.deepStrictEqual(arr[0].range, codeLoc.range);
  });
});
