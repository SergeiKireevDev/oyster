import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_WORKSPACE_KEY, chooseOnlineWorkspace, ensureActiveWorkspace, listEnvironments, listOnlineWorkspaces, listWorkspaces } from "../public/src/runtime/workspaceScope.js";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

const hub = { hub: true };

test("environment discovery returns every llmbox spoke", async () => {
  const environments = await listEnvironments({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { environments: [
          { id: "local", name: "Local", status: "online", local: true },
          { id: "edge-2", name: "Edge 2", status: "offline" },
        ] };
      },
    }),
  });
  assert.deepEqual(environments.map(({ id }) => id), ["local", "edge-2"]);
});

test("workspace discovery preserves lifecycle statuses for Hub indicators", async () => {
  const workspaces = [
    { id: "alpha", status: "online" },
    { id: "beta", status: "provisioning" },
    { id: "gamma", status: "offline" },
    { id: "delta", status: "paused" },
  ];
  assert.deepEqual(await listWorkspaces({
    fetchImpl: async () => ({ ok: true, async json() { return { workspaces }; } }),
  }), workspaces);
});

test("new-session workspace choices include only online workspaces", async () => {
  const selected = await listOnlineWorkspaces({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { workspaces: [
          { id: "alpha", status: "online" },
          { id: "beta", status: "provisioning" },
          { id: "gamma", status: "offline" },
        ] };
      },
    }),
  });
  assert.deepEqual(selected, [{ id: "alpha", status: "online" }]);
});

test("new-session workspace choices surface Hub discovery failures", async () => {
  await assert.rejects(
    listOnlineWorkspaces({
      fetchImpl: async () => ({ ok: false, status: 503, async json() { return { error: "driver unavailable" }; } }),
    }),
    /driver unavailable/,
  );
});

test("Hub session creation requires an explicit online workspace choice", async () => {
  const seen = [];
  const fetchImpl = async () => ({
    ok: true,
    async json() { return { workspaces: [{ id: "alpha", status: "online" }, { id: "beta", status: "online" }] }; },
  });
  const selected = await chooseOnlineWorkspace({
    fetchImpl,
    choose: async (workspaces) => { seen.push(workspaces.map(({ id }) => id)); return 1; },
  });
  assert.equal(selected.id, "beta");
  assert.deepEqual(seen, [["alpha", "beta"]]);
  assert.equal(await chooseOnlineWorkspace({ fetchImpl, choose: async () => null }), null, "cancel does not imply a default workspace");
});

test("Hub session creation rejects an empty workspace fleet before showing a folder", async () => {
  let chose = false;
  await assert.rejects(
    chooseOnlineWorkspace({
      fetchImpl: async () => ({ ok: true, async json() { return { workspaces: [] }; } }),
      choose: async () => { chose = true; return 0; },
    }),
    /no online workspaces available/,
  );
  assert.equal(chose, false);
});

test("Hub startup preserves an available explicit workspace", async () => {
  const localStorage = storage({ [ACTIVE_WORKSPACE_KEY]: "beta" });
  const selected = await ensureActiveWorkspace({
    runtimeConfig: hub,
    storage: localStorage,
    fetchImpl: async () => ({
      ok: true,
      async json() { return { workspaces: [{ id: "alpha", status: "online" }, { id: "beta", status: "online" }] }; },
    }),
  });
  assert.equal(selected.id, "beta");
  assert.equal(localStorage.getItem(ACTIVE_WORKSPACE_KEY), "beta");
});

test("Hub startup explicitly selects an available workspace instead of relying on a server fallback", async () => {
  const localStorage = storage();
  const selected = await ensureActiveWorkspace({
    runtimeConfig: hub,
    storage: localStorage,
    fetchImpl: async () => ({
      ok: true,
      async json() { return { workspaces: [{ id: "local", status: "online" }] }; },
    }),
  });
  assert.equal(selected.id, "local");
  assert.equal(localStorage.getItem(ACTIVE_WORKSPACE_KEY), "local");
});

test("Hub startup stops before connecting when no workspace is available", async () => {
  await assert.rejects(
    ensureActiveWorkspace({
      runtimeConfig: hub,
      storage: storage(),
      fetchImpl: async () => ({ ok: true, async json() { return { workspaces: [] }; } }),
    }),
    /create an environment or workspace first/,
  );
});
