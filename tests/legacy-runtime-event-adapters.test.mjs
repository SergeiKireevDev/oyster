import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyRuntimeEventAdapters } from "../public/src/runtime/legacyRuntimeEventAdapters.js";

test("runtime event adapters attach once and then apply the carousel", () => {
  const calls = [];
  const runtime = createLegacyRuntimeEventAdapters({
    attachers: [{ attach: () => calls.push("first") }, { attach: () => calls.push("second") }],
    applyCarousel: () => calls.push("carousel"),
  });

  runtime.attach();
  runtime.attach();

  assert.deepEqual(calls, ["first", "second", "carousel"]);
});
