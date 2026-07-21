import test from "node:test";
import assert from "node:assert/strict";
import { createHublotManagerController } from "../public/src/lib/hublotManagerController.js";
test("hublot manager opens its modal before refreshing", async () => { const calls = []; const controller = createHublotManagerController({ resetCarousel: () => calls.push("reset"), openModal: (value) => calls.push(value), refresh: async (value) => calls.push(value), getScopeAll: () => false }); await controller.show(); assert.equal(calls[1].title, "Hublots — this session"); assert.deepEqual(calls[2], { loading: true }); });
