import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import { appHeader, appSession } from "../public/src/stores/appSession.js";

test("empty sessions use the default title", () => {
  appSession.update((session) => ({ ...session, state: { sessionName: null }, titleOverride: null }));

  assert.equal(get(appHeader).sessionTitle, "Empty session");
});
