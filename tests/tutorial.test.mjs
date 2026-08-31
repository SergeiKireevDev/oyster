import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCredentialsAssembly } from "../public/src/features/credentials/createCredentialsAssembly.js";
import { createTutorialAssembly } from "../public/src/features/tutorial/createTutorialAssembly.js";
import { createTutorialController, TUTORIAL_COMPLETION_KEY } from "../public/src/features/tutorial/createTutorialController.js";
import { TUTORIAL_STEPS } from "../public/src/features/tutorial/tutorialSteps.js";
import {
  CREDENTIALS_CLOSE_ACTION,
  CREDENTIALS_SAVE_API_KEY_ACTION,
  TUTORIAL_DISMISS_ACTION,
  TUTORIAL_NEXT_ACTION,
  TUTORIAL_OPEN_ACTION,
  TUTORIAL_PREVIOUS_ACTION,
} from "../public/src/runtime/uiActionNames.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key) ?? null; },
  };
}

test("tutorial controller opens once, navigates, and remembers completion", () => {
  const storage = memoryStorage();
  const states = [];
  const controller = createTutorialController({ storage, setState: (patch) => states.push(patch) });

  assert.equal(controller.initialize(), true);
  assert.deepEqual(states.at(-1), { active: true, stepIndex: 0 });
  assert.equal(controller.initialize(), false, "startup initialization is idempotent");
  assert.equal(controller.previous(), false);

  for (let index = 1; index < TUTORIAL_STEPS.length; index++) assert.equal(controller.next(), true);
  assert.deepEqual(states.at(-1), { stepIndex: TUTORIAL_STEPS.length - 1 });
  assert.equal(controller.next(), true);
  assert.deepEqual(states.at(-1), { active: false, stepIndex: 0 });
  assert.equal(storage.value(TUTORIAL_COMPLETION_KEY), "1");

  assert.equal(controller.open(), true, "the menu can replay a completed tutorial");
  assert.deepEqual(states.at(-1), { active: true, stepIndex: 0 });
});

test("completed tutorial does not auto-open in a later application runtime", () => {
  const states = [];
  const controller = createTutorialController({
    storage: memoryStorage({ [TUTORIAL_COMPLETION_KEY]: "1" }),
    setState: (patch) => states.push(patch),
  });

  assert.equal(controller.initialize(), false);
  assert.deepEqual(states, []);
});

test("tutorial assembly owns scoped actions and releases them on teardown", () => {
  const uiActions = createUiActionRegistry();
  const states = [];
  const assembly = createTutorialAssembly({
    uiActions,
    storage: memoryStorage(),
    setState: (patch) => states.push(patch),
  });

  uiActions.invoke(TUTORIAL_OPEN_ACTION);
  uiActions.invoke(TUTORIAL_NEXT_ACTION);
  uiActions.invoke(TUTORIAL_PREVIOUS_ACTION);
  uiActions.invoke(TUTORIAL_DISMISS_ACTION);
  assert.deepEqual(states.slice(0, 4), [
    { active: true, stepIndex: 0 },
    { stepIndex: 1 },
    { stepIndex: 0 },
    { active: false, stepIndex: 0 },
  ]);

  assembly.teardown();
  const stateCount = states.length;
  uiActions.invoke(TUTORIAL_OPEN_ACTION);
  assert.equal(states.length, stateCount);
  assembly.teardown();
});

test("first-run credential setup starts the tutorial only after setup closes", async () => {
  const uiActions = createUiActionRegistry();
  const opened = [];
  let tutorialStarts = 0;
  const assembly = createCredentialsAssembly({
    uiActions,
    openModal: (modal) => opened.push(modal),
    setState() {},
    onSetupClosed: () => { tutorialStarts += 1; },
    createController: () => ({
      activate() {}, deactivate() {},
      async load() { return [{ provider: "mock", configured: false, credentialType: null }]; },
      save() {}, remove() {}, startOAuth() {}, respondOAuth() {}, cancelOAuth() {}, logoutOAuth() {}, teardown() {},
    }),
  });

  assert.equal(await assembly.operations.initialize(), true);
  assert.equal(tutorialStarts, 0);
  assert.equal(opened[0].title, "Set up credentials");
  uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
  assert.equal(tutorialStarts, 0, "temporary modal transitions do not start the tutorial");
  uiActions.invoke(CREDENTIALS_CLOSE_ACTION, { completedSetup: true });
  assert.equal(tutorialStarts, 1);
  uiActions.invoke(CREDENTIALS_CLOSE_ACTION, { completedSetup: true });
  assert.equal(tutorialStarts, 1, "repeated close signals do not restart the tutorial");
  assembly.teardown();
});

test("credential setup completed through API-key confirmation also starts the tutorial", async () => {
  const uiActions = createUiActionRegistry();
  let tutorialStarts = 0;
  const assembly = createCredentialsAssembly({
    uiActions,
    openModal() {},
    setState() {},
    onSetupClosed: () => { tutorialStarts += 1; },
    createController: () => ({
      activate() {}, deactivate() {},
      async load() { return [{ provider: "mock", configured: false, credentialType: null }]; },
      async save() { return { ok: true }; },
      remove() {}, startOAuth() {}, respondOAuth() {}, cancelOAuth() {}, logoutOAuth() {}, teardown() {},
    }),
  });

  await assembly.operations.initialize();
  uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
  assert.equal(tutorialStarts, 0);
  await uiActions.invoke(CREDENTIALS_SAVE_API_KEY_ACTION, { provider: "mock", key: "test-only" });
  assert.equal(tutorialStarts, 1);
  assembly.teardown();
});

test("tutorial UI is an accessible responsive spotlight and remains replayable", () => {
  const component = readFileSync(new URL("../public/src/components/Tutorial.svelte", import.meta.url), "utf8");
  const menu = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
  const root = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");

  assert.match(component, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="tutorialTitle"/);
  assert.match(component, /use:tutorialPresentation=/);
  assert.match(component, />Skip tour<\/button>/);
  assert.match(component, /finalStep \? "Finish" : "Next"/);
  assert.match(component, /@media \(max-width: 520px\)/);
  assert.match(component, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(menu, /data-action="tutorial"[\s\S]*>Take the tour…<\/span>/);
  assert.match(root, /onSetupClosed: tutorialAssembly\.operations\.initialize/);
  assert.match(root, /credentialsAssembly\.operations\.initialize\(\)\.then\(\(setupOpened\) => \{\s*if \(!setupOpened\) tutorialAssembly\.operations\.initialize\(\)/);
});
