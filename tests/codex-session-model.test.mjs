import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexSessionModelReader } from "../server/runner-drivers/codex-session-model.mjs";

test("Codex model reader follows the session's latest complete turn context", (t) => {
  const home = mkdtempSync(join(tmpdir(), "codex-model-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const read = createCodexSessionModelReader(home, "thread-1");
  assert.equal(read(), null);
  const dir = join(home, "sessions", "2026", "09", "10");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-date-thread-1.jsonl");
  writeFileSync(join(dir, "rollout-date-other.jsonl"), '{"type":"turn_context","payload":{"model":"wrong"}}\n');
  writeFileSync(path, '{"type":"session_meta","payload":{"model_provider":"openai"}}\n');
  assert.equal(read(), null);
  appendFileSync(path, '{"type":"turn_context","payload":{"model":"configured-model"}}\n');
  assert.equal(read(), "configured-model");
  assert.equal(read(), "configured-model");
  appendFileSync(path, 'invalid\n{"type":"turn_context","payload":{"model":"switched');
  assert.equal(read(), "configured-model");
  appendFileSync(path, '-model"}}\n{"type":"turn_context","payload":{"model":null}}\n');
  assert.equal(read(), "switched-model");
  assert.equal(createCodexSessionModelReader(home, "thread-1")(), "switched-model");
});
