import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
const firstGroup = [
  "TextPromptModal.svelte",
  "EditorPromptModal.svelte",
  "ConfirmPromptModal.svelte",
  "OptionPickerModal.svelte",
  "CheckpointModelPickerModal.svelte",
  "HublotManagerModal.svelte",
];

test("prompt picker checkpoint and hublot modal controls use native buttons", () => {
  for (const name of firstGroup) {
    assert.doesNotMatch(read(name), /<span\b[^>]*role="button"/, `${name} must not emulate buttons with spans`);
  }

  assert.match(read("TextPromptModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelText\}>Cancel<\/button>/);
  assert.match(read("EditorPromptModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelEditor\}>Cancel<\/button>/);
  assert.match(read("ConfirmPromptModal.svelte"), /<button class="chip" onclick=\{\(\) => dialogs\.answerConfirm\(false\)\}>No<\/button>/);
  assert.match(read("OptionPickerModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelOption\}>Cancel<\/button>/);
  assert.match(read("CheckpointModelPickerModal.svelte"), /<button class="chip" onclick=\{cancelCheckpointModelPicker\}>Cancel<\/button>/);

  const hublot = read("HublotManagerModal.svelte");
  assert.match(hublot, /<button class="chip" title="toggle between this session's tunnels and all of them" onclick=\{toggleManagedHublotScope\}>/);
  assert.match(hublot, /<button class="chip" onclick=\{closeModalState\}>Close<\/button>/);
  assert.match(hublot, /<button\s+class="x"\s+title="close this hublot"/);
});
