import * as assert from "assert";
import sinon from "sinon";
import { openLocationHandler } from "../../../commands/openLocationCommand";
import { MockWorkspaceService } from "../mocks/mockWorkspaceService";

suite("openLocationCommand (unit)", () => {
  let workspace: MockWorkspaceService;

  setup(() => {
    workspace = new MockWorkspaceService();
  });

  teardown(() => {
    sinon.restore();
  });

  test("openLocationHandler should call showTextDocument with uri and selection", async () => {
    const stub = sinon.stub(workspace, "showTextDocument").resolves();

    const payload = [
      {
        uri: "file:///proj/locales/en.po",
        location: { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
      },
    ];

    await openLocationHandler(workspace as any, payload as any);

    assert.ok(stub.calledOnce, "showTextDocument should be called");
    const calledWith = stub.getCall(0).args[0];
    const options = stub.getCall(0).args[1];
    assert.ok(calledWith.toString().endsWith("/proj/locales/en.po"));
    assert.ok(options && options.selection);
    assert.strictEqual(options.selection.start.line, 2);
  });
});
