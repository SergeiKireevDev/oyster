import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { createWorkspaceService } from "../public/src/features/workspaces/createWorkspaceService.js";

const componentRoot = new URL("../public/src/", import.meta.url);

function components(directory = componentRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return components(file);
    return entry.name.endsWith(".svelte") ? [file] : [];
  });
}

test("components delegate transport and persistence to scoped services", () => {
  const violations = components().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [
      [/\bfetch\s*\(/g, "fetch"],
      [/\b(?:localStorage|sessionStorage|indexedDB)\b/g, "browser persistence"],
      [/new\s+(?:WebSocket|EventSource)\s*\(/g, "transport construction"],
      [/["'`]\/api\//g, "API route"],
      [/\b(?:encodeURIComponent|URLSearchParams)\b/g, "URL construction"],
      [/\bresponse\.(?:json|ok|status)\b/g, "protocol response interpretation"],
      [/[?&](?:token|workspace)=\$?\{/g, "tokenized URL"],
    ].flatMap(([pattern, label]) => [...source.matchAll(pattern)].map((match) =>
      `${relative(componentRoot.pathname, file.pathname)}:${source.slice(0, match.index).split("\n").length} ${label}`));
  });

  assert.deepEqual(violations, []);
});

test("workspace service owns request construction and returns domain values", async () => {
  const calls = [];
  const responses = [
    { environments: [{ id: "local" }] },
    { workspace: { id: "box-1" } },
    { flow: { id: "oauth-1", status: "pending" } },
    { regions: [{ id: "nyc3" }], defaults: { region: "nyc3" } },
  ];
  const service = createWorkspaceService({
    async fetchImpl(path, init) {
      calls.push({ path, init });
      return { ok: true, json: async () => responses.shift() };
    },
  });

  assert.deepEqual(await service.listEnvironments(), [{ id: "local" }]);
  assert.deepEqual(await service.createLlmboxWorkspace({ id: "box-1", spoke: "gpu" }), { id: "box-1" });
  assert.deepEqual(await service.startCloudAuthorization("digital ocean"), { id: "oauth-1", status: "pending" });
  assert.deepEqual(await service.getCloudOptions("digital ocean", "nyc 3"), {
    regions: [{ id: "nyc3" }], sizes: [], images: [], defaults: { region: "nyc3" },
  });
  assert.equal(service.googleComputeConsoleUrl(), "https://console.cloud.google.com/apis/library/compute.googleapis.com");
  assert.equal(
    service.googleComputeConsoleUrl("project + one"),
    "https://console.cloud.google.com/apis/library/compute.googleapis.com?project=project%20%2B%20one",
  );
  assert.deepEqual(calls, [
    { path: "/api/v1/environments", init: undefined },
    {
      path: "/api/v1/workspaces",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "box-1", spoke: "gpu" }),
      },
    },
    { path: "/api/v1/cloud/providers/digital%20ocean/authorization/start", init: { method: "POST" } },
    { path: "/api/v1/cloud/providers/digital%20ocean/options?region=nyc%203", init: undefined },
  ]);
});

test("workspace service centralizes failed response messages", async () => {
  const service = createWorkspaceService({
    async fetchImpl() {
      return { ok: false, status: 409, json: async () => ({ error: "workspace already exists" }) };
    },
  });

  await assert.rejects(service.createLlmboxWorkspace({ id: "taken" }), /workspace already exists/);
});
