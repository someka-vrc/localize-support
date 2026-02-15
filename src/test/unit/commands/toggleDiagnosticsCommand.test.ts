import * as assert from "assert";
import sinon from "sinon";
import { registerToggleDiagnosticsCommand } from "../../../commands/toggleDiagnosticsCommand";
import { MockCommandWrapper, MockIWindowWrapper } from "../mocks/mockVscodeWrapper";

suite("registerToggleDiagnosticsCommand (unit)", () => {
  let command: MockCommandWrapper;
  let win: MockIWindowWrapper;

  setup(() => {
    command = new MockCommandWrapper();
    win = new MockIWindowWrapper();
  });

  teardown(() => {
    sinon.restore();
  });

  test("should register command and toggle from enabled -> disabled", async () => {
    let registeredCallback: any = null;
    (sinon.stub(command as any, "registerCommand") as any).callsFake((cmd: string, cb: any) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    });

    const logger = win.logger as any;

    // fake workspaceState
    const workspaceState = {
      get: sinon.stub().withArgs("localize-support.diagnosticsEnabled", true).returns(true),
      update: sinon.stub().resolves(),
    } as any;

    const diagProvider = { setEnabled: sinon.stub().resolves() } as any;

    // stub showInformationMessage to avoid unhandled rejection in mock
    sinon.stub(win as any, "showInformationMessage").resolves();

    registerToggleDiagnosticsCommand(command as any, logger, win as any, diagProvider as any, workspaceState as any);

    assert.strictEqual((command as any).registerCommand.calledOnce, true);
    assert.strictEqual((command as any).registerCommand.getCall(0).args[0], "localize-support.toggleDiagnostics");

    // call registered callback
    await registeredCallback();

    assert.ok((workspaceState.update as sinon.SinonStub).calledOnceWithExactly("localize-support.diagnosticsEnabled", false));
    assert.ok((diagProvider.setEnabled as sinon.SinonStub).calledOnceWithExactly(false));
  });

  test("should show information message with correct text when toggled on/off", async () => {
    let registeredCallback: any = null;
    (sinon.stub(command as any, "registerCommand") as any).callsFake((cmd: string, cb: any) => {
      registeredCallback = cb;
      return { dispose: () => {} };
    });

    const logger = win.logger as any;

    // starting disabled
    const workspaceState = {
      get: sinon.stub().withArgs("localize-support.diagnosticsEnabled", true).returns(false),
      update: sinon.stub().resolves(),
    } as any;

    const diagProvider = { setEnabled: sinon.stub().resolves() } as any;

    const showMsgStub = sinon.stub(win as any, "showInformationMessage").resolves();

    registerToggleDiagnosticsCommand(command as any, logger, win as any, diagProvider as any, workspaceState as any);

    // invoke registered command
    await registeredCallback();

    assert.ok(showMsgStub.calledOnce);
    assert.strictEqual(showMsgStub.getCall(0).args[0], "Diagnostics are now ON");
  });
});
