import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionCoordinator } from "../public/src/platform/connectionCoordinator.js";

test("connection coordinator exposes injected lifecycle boundary", () => {
  const connect = () => "connected";
  let disconnects = 0;
  const coordinator = createConnectionCoordinator({ connect, disconnect: () => { disconnects += 1; }, refreshState: () => {}, dispatch: () => {} });
  assert.equal(coordinator.connect(), "connected");
  coordinator.teardown();
  assert.equal(disconnects, 1);
  assert.equal(coordinator.connect(), undefined);
});
