import test from "node:test";
import assert from "node:assert/strict";
import { createComposerHistoryController } from "../public/src/lib/composerHistoryController.js";

function fixture(value = "", start = value.length, end = start) {
  const state = { value, start, end };
  const history = createComposerHistoryController({
    getValue: () => state.value,
    getSelection: () => ({ start: state.start, end: state.end }),
    setValue: (next) => { state.value = next; state.start = state.end = next.length; },
  });
  return { state, history };
}

test("composer history recalls prompts and restores the current draft", () => {
  const { state, history } = fixture("draft");
  history.remember("first");
  history.remember("second");
  history.remember("second");
  assert.equal(history.navigate(-1), true);
  assert.equal(state.value, "second");
  assert.equal(history.navigate(-1), true);
  assert.equal(state.value, "first");
  assert.equal(history.navigate(1), true);
  assert.equal(state.value, "second");
  assert.equal(history.navigate(1), true);
  assert.equal(state.value, "draft");
});

test("composer history clear discards recalled prompts and drafts", () => {
  const { state, history } = fixture("draft");
  history.remember("prompt");
  assert.equal(history.navigate(-1), true);
  history.clear();
  assert.equal(history.navigate(1), false);
  assert.equal(history.navigate(-1), false);
  assert.equal(state.value, "prompt");
});

test("composer history leaves multiline cursor navigation alone", () => {
  const { state, history } = fixture("top\nbottom", 5);
  history.remember("prompt");
  assert.equal(history.navigate(-1), false);
  state.value = "top\nbottom";
  state.start = state.end = 2;
  assert.equal(history.navigate(-1), true);
  state.value = "top\nbottom";
  state.start = state.end = 2;
  assert.equal(history.navigate(1), false);
});
