import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { get } from "svelte/store";
import {
  createCheckpointModelPickerService,
  emptyCheckpointModelPicker,
} from "../public/src/runtime/checkpointModelPickerService.js";

function createHarness(preferred = "") {
  const calls = [];
  let preference = preferred;
  const service = createCheckpointModelPickerService({
    modelPreference: {
      get: () => preference,
      set: (value) => { preference = value; calls.push(["preference", value]); },
    },
    modalShell: {
      open: (options) => calls.push(["open", options]),
      close: () => calls.push(["close"]),
    },
  });
  return { service, calls, getPreference: () => preference };
}

test("checkpoint picker service instances own independent state and preferences", async () => {
  const first = createHarness("provider/first");
  const second = createHarness("provider/second");
  const firstChoice = first.service.open({ title: "First", models: ["provider/first"] });
  const secondChoice = second.service.open({ title: "Second", hint: "Choose", okLabel: "Use" });

  assert.deepEqual(get(first.service.state), {
    title: "First", hint: "", okLabel: "Freeze 🧊", models: ["provider/first"], selected: "provider/first", loading: false,
  });
  assert.equal(get(second.service.state).title, "Second");
  second.service.setSelected("provider/new");
  second.service.submit();
  first.service.cancel();

  assert.deepEqual(await secondChoice, { model: "provider/new" });
  assert.deepEqual(await firstChoice, { cancelled: true });
  assert.equal(second.getPreference(), "provider/new");
  assert.deepEqual(get(first.service.state), { ...emptyCheckpointModelPicker });
  assert.deepEqual(get(second.service.state), { ...emptyCheckpointModelPicker });
});

test("checkpoint picker modal consumes the scoped service and preserves controls", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointModelPickerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getCheckpointModelPicker\(\)/);
  assert.match(source, /const checkpointModelPicker = picker\.state/);
  assert.match(source, /picker\.setSelected\(value\)/);
  assert.match(source, /picker\.cancel\(\)/);
  assert.match(source, /picker\.submit\(\)/);
  assert.match(source, /No summary — timestamp message/);
  assert.doesNotMatch(source, /stores\/checkpointModelPicker\.js/);
});

test("checkpoint picker has no obsolete global store references", () => {
  const sourceRoot = new URL("../public/src/", import.meta.url);
  const references = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) visit(url);
      else if (/\.(?:js|svelte)$/.test(entry.name)) {
        const source = readFileSync(url, "utf8");
        if (/stores\/checkpointModelPicker\.js/.test(source)) references.push(url.pathname.slice(sourceRoot.pathname.length));
      }
    }
  };
  visit(sourceRoot);

  assert.equal(existsSync(new URL("stores/checkpointModelPicker.js", sourceRoot)), false);
  assert.deepEqual(references, []);
});

test("opening a replacement settles the previous picker before owning the resolver", async () => {
  const { service, calls } = createHarness("remembered/model");
  const replaced = service.open({ title: "Old" });
  const current = service.open({ title: "New", loading: true });

  assert.deepEqual(await replaced, { cancelled: true });
  assert.equal(get(service.state).title, "New");
  assert.equal(get(service.state).loading, true);
  assert.deepEqual(calls.filter(([kind]) => kind === "open"), [
    ["open", { title: "Old", content: "checkpointModelPicker" }],
    ["open", { title: "New", content: "checkpointModelPicker" }],
  ]);
  assert.equal(calls.some(([kind]) => kind === "close"), false);

  service.cancel();
  assert.deepEqual(await current, { cancelled: true });
  assert.equal(calls.at(-1)[0], "close");
});

test("checkpoint picker teardown settles an open promise and prevents reuse", async () => {
  const { service, calls } = createHarness();
  const pending = service.open({ title: "Pending" });

  service.teardown();
  service.teardown();

  assert.deepEqual(await pending, { cancelled: true });
  assert.deepEqual(get(service.state), { ...emptyCheckpointModelPicker });
  assert.equal(calls.filter(([kind]) => kind === "close").length, 1);
  assert.deepEqual(await service.open({ title: "Disposed" }), { cancelled: true });
  assert.equal(calls.filter(([kind]) => kind === "open").length, 1);
});
