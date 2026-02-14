import * as assert from "assert";
import sinon from "sinon";
import { openLocationHandler } from "../../../commands/openLocationCommand";
import { MockIWindowWrapper } from "../mocks/mockWorkspaceService";

suite("openLocationCommand (unit)", () => {
  let win: MockIWindowWrapper;

  setup(() => {
    win = new MockIWindowWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("openLocationHandler should call showTextDocument with uri and selection", async () => {
    const stub = sinon.stub(win, "showTextDocument").resolves();

    const payload = [
      {
        uri: "file:///proj/locales/en.po",
        location: { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
      },
    ];

    await openLocationHandler(win as any, payload as any);

    assert.ok(stub.calledOnce, "showTextDocument should be called");
    const calledWith = stub.getCall(0).args[0];
    const options = stub.getCall(0).args[1];
    assert.ok(calledWith.toString().endsWith("/proj/locales/en.po"));
    assert.ok(options && options.selection);
    assert.strictEqual(options.selection.start.line, 2);
  });

  test("openLocationHandler should return when uri is missing (early return)", async () => {
    const stub = sinon.stub(win, "showTextDocument").resolves();

    // payload has no uri -> should early-return and NOT call showTextDocument
    const payload = [{ location: { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } } } }];

    await openLocationHandler(win as any, payload as any);

    assert.ok(stub.notCalled, "showTextDocument should not be called when uri is missing");
  });
});
