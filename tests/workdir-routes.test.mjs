import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createRequestContext } from "../server/http/createRequestContext.mjs";
import { createWorkdirRoutes } from "../server/http/routes/workdirRoutes.mjs";

function reqBody(body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.headers = {};
  return request;
}

function res() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function routeFor(state, overrides = {}) {
  return createWorkdirRoutes({
    state,
    requestContext: createRequestContext(state),
    spawnRunner: (options) => ({ id: "r2", ...options }),
    runnerInfo: (runner) => ({ id: runner.id, dir: runner.dir }),
    logger: { log() {} },
    ...overrides,
  })["POST /workdir"];
}

test("workdir validates confinement, switches state, and spawns the selected runner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workdir-route-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "file");
  await writeFile(file, "x");
  const persisted = [];
  const state = {
    config: { TOKEN: "x", PI_DIR: root, DIRNAME: root },
    currentDir: "/old",
    appSettings: {
      setCurrentWorkdir(value) {
        persisted.push(value);
        return "/unexpected-setting-return-value";
      },
    },
  };
  const spawned = [];
  const route = routeFor(state, {
    spawnRunner: (options) => { spawned.push(options); return { id: "r2", ...options }; },
  });

  const forbidden = res();
  await route(reqBody({ path: "/etc" }), forbidden);
  assert.equal(forbidden.status, 403);
  const invalid = res();
  await route(reqBody({ path: file }), invalid);
  assert.equal(invalid.status, 400);
  const changed = res();
  await route(reqBody({ path: root }), changed);

  assert.equal(changed.status, 200);
  assert.equal(changed.headers["cache-control"], "no-store");
  assert.equal(state.currentDir, root);
  assert.deepEqual(persisted, [root]);
  assert.deepEqual(spawned, [{ dir: root }]);
  assert.deepEqual(changed.body, { workdir: root, runner: { id: "r2", dir: root } });
});

test("workdir rejects malformed path payloads before resolving or spawning", async () => {
  const state = { config: { TOKEN: "x", PI_DIR: "/tmp", DIRNAME: "/tmp" }, currentDir: "/old" };
  let spawned = 0;
  const route = routeFor(state, { spawnRunner: () => { spawned++; } });
  const cases = [
    [null, "request body must be a JSON object"],
    [[], "request body must be a JSON object"],
    [{}, "path must be a non-empty string"],
    [{ path: 123 }, "path must be a non-empty string"],
    [{ path: "   " }, "path must be a non-empty string"],
    [{ path: "bad\0path" }, "path must not contain null bytes or exceed 16 KiB"],
    [{ path: "x".repeat(16 * 1024 + 1) }, "path must not contain null bytes or exceed 16 KiB"],
  ];

  for (const [body, message] of cases) {
    const response = res();
    await route(reqBody(body), response);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, message);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(spawned, 0);
  assert.equal(state.currentDir, "/old");
});

test("workdir persistence failures do not mutate state or spawn a runner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workdir-route-persist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = {
    config: { TOKEN: "x", PI_DIR: root, DIRNAME: root },
    currentDir: "/old",
    appSettings: { setCurrentWorkdir() { throw new Error("database unavailable"); } },
  };
  let spawned = 0;
  const route = routeFor(state, { spawnRunner: () => { spawned++; } });

  await assert.rejects(route(reqBody({ path: root }), res()), /database unavailable/);
  assert.equal(state.currentDir, "/old");
  assert.equal(spawned, 0);
});

test("workdir logging failures do not interrupt runner creation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workdir-route-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { config: { TOKEN: "x", PI_DIR: root, DIRNAME: root }, currentDir: "/old" };
  const response = res();
  await routeFor(state, { logger: { log() { throw new Error("logger unavailable"); } } })(reqBody({ path: root }), response);

  assert.equal(response.status, 200);
  assert.equal(state.currentDir, root);
});

test("workdir route factory validates required dependencies", () => {
  const state = { config: { TOKEN: "x", PI_DIR: "/tmp", DIRNAME: "/tmp" }, currentDir: "/tmp" };
  const requestContext = createRequestContext(state);
  const spawnRunner = () => ({});
  const runnerInfo = () => ({});

  assert.throws(() => createWorkdirRoutes(), /state is required/);
  assert.throws(() => createWorkdirRoutes({ state }), /requestContext is required/);
  assert.throws(() => createWorkdirRoutes({ state, requestContext }), /spawnRunner is required/);
  assert.throws(() => createWorkdirRoutes({ state, requestContext, spawnRunner }), /runnerInfo is required/);
  assert.throws(
    () => createWorkdirRoutes({ state: { ...state, appSettings: {} }, requestContext, spawnRunner, runnerInfo }),
    /setCurrentWorkdir must be a function/,
  );
});
