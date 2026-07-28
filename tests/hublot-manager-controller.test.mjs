import test from "node:test";
import assert from "node:assert/strict";
import { createHublotManagerController } from "../public/src/lib/hublotManagerController.js";

test("widget manager opens without dismissing the mobile sidebar before refreshing", async () => {
  const calls = [];
  const controller = createHublotManagerController({
    openModal: (value) => calls.push(value),
    refresh: async (value) => calls.push(value),
    getScopeAll: () => false,
  });
  await controller.show();
  assert.equal(calls[0].title, "Pin widget");
  assert.deepEqual(calls[1], { loading: true });
});
