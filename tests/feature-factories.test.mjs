import test from "node:test";
import assert from "node:assert/strict";
import { createHublotFeature } from "../public/src/features/hublots/createHublotFeature.js";
import { createRoutineFeature } from "../public/src/features/routines/createRoutineFeature.js";
import { createSettingsFeature } from "../public/src/features/settings/createSettingsFeature.js";
import { createLayoutFeature } from "../public/src/features/layout/createLayoutFeature.js";

for (const [name, factory] of Object.entries({ hublot: createHublotFeature, routine: createRoutineFeature, settings: createSettingsFeature, layout: createLayoutFeature })) {
  test(`${name} feature factory tears down its controller`, () => {
    let tornDown = false;
    const feature = factory({ createController: () => ({ teardown: () => { tornDown = true; } }), dependencies: {} });
    feature.teardown();
    assert.equal(tornDown, true);
  });
}
