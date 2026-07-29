import test from "node:test";
import assert from "node:assert/strict";
import { createHublotManagerController } from "../public/src/lib/hublotManagerController.js";

test("widget manager opens only the new live-interface form", () => {
  const calls = [];
  const controller = createHublotManagerController({ openModal: (value) => calls.push(value) });
  controller.show();
  assert.deepEqual(calls, [{ title: "New live interface widget", wide: true, content: "hublotManager" }]);
});
