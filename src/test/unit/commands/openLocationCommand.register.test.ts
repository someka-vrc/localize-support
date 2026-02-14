import * as assert from "assert";
import sinon from "sinon";
import { registerOpenLocationCommand } from "../../../commands/openLocationCommand";
import { MockWorkspaceService } from "../mocks/mockWorkspaceService";

suite("registerOpenLocationCommand (unit)", () => {
  let workspace: MockWorkspaceService;

  setup(() => {
    workspace = new MockWorkspaceService();
  });

  teardown(() => {
    sinon.restore();
  });

  test("should register workspace command and callback should open document", async () => {
    let registeredCallback: any = null;
    const regStub = (sinon.stub(workspace as any, "registerCommand") as any).callsFake((cmd: string, cb: any) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    });

    const showStub = sinon.stub(workspace as any, "showTextDocument").resolves();

    const disp = registerOpenLocationCommand(workspace as any);

    assert.ok(regStub.calledOnce);
    assert.strictEqual(regStub.getCall(0).args[0], "localize-support.openLocation");

    // invoke registered callback
    const payload = { uri: "file:///proj/locales/en.po", location: { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } } };
    await registeredCallback([payload]);

    assert.ok(showStub.calledOnce);
    const calledUri = showStub.getCall(0).args[0];
    assert.ok(calledUri.toString().endsWith("/proj/locales/en.po"));
  });
});
