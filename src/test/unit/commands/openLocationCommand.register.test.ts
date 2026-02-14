import * as assert from "assert";
import sinon from "sinon";
import { registerOpenLocationCommand } from "../../../commands/openLocationCommand";
import { MockCommandWrapper, MockIWindowWrapper } from "../mocks/mockWorkspaceService";

suite("registerOpenLocationCommand (unit)", () => {
  let command: MockCommandWrapper;
  let win: MockIWindowWrapper;

  setup(() => {
    command = new MockCommandWrapper();
    win = new MockIWindowWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("should register workspace command and callback should open document", async () => {
    let registeredCallback: any = null;
    const regStub = (sinon.stub(command as any, "registerCommand") as any).callsFake((cmd: string, cb: any) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    });

    const showStub = sinon.stub(win as any, "showTextDocument").resolves();

    const logger = win.logger as any;
    const disp = registerOpenLocationCommand(command as any, logger, win as any);

    assert.ok(regStub.calledOnce);
    assert.strictEqual(regStub.getCall(0).args[0], "localize-support.openLocation");

    // invoke registered callback
    const payload = { uri: "file:///proj/locales/en.po", location: { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } } };
    await registeredCallback([payload]);

    assert.ok(showStub.calledOnce);
    const calledUri = showStub.getCall(0).args[0];
    assert.ok(calledUri.toString().endsWith("/proj/locales/en.po"));
  });

  test("should call logger.error when handler throws", async () => {
    let registeredCallback: any = null;
    (sinon.stub(command as any, "registerCommand") as any).callsFake((cmd: string, cb: any) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    });

    // make showTextDocument reject to cause handler to throw
    const err = new Error("boom");
    sinon.stub(win as any, "showTextDocument").rejects(err);

    const logger = win.logger as any;
    // stub logger.error so the underlying MockLogOutputChannel.error doesn't print to console during test
    const loggerErrorSpy = sinon.stub(logger, "error").callsFake(() => {});

    registerOpenLocationCommand(command as any, logger, win as any);

    const payload = { uri: "file:///proj/locales/en.po" };
    await registeredCallback([payload]);

    assert.ok(loggerErrorSpy.calledOnce, "logger.error should be called on handler failure");
    assert.strictEqual((loggerErrorSpy.getCall(0).args[0] as string).indexOf("localize-support.openLocation failed") !== -1, true);
  });
});
