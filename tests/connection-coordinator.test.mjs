import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionCoordinator } from "../public/src/platform/connectionCoordinator.js";

test("connection coordinator exposes injected lifecycle boundary", () => {
  const connect = () => "connected";
  const coordinator = createConnectionCoordinator({ connect, disconnect: () => {}, refreshState: () => {}, dispatch: () => {} });
  assert.equal(coordinator.connect, connect);
});
