import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployment = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const local = readFileSync(new URL("../Dockerfile.local-pi", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const containerDocs = readFileSync(new URL("../docs/operations/containers.md", import.meta.url), "utf8");

test("deployment Docker image builds the pi submodule and uses SQLite", () => {
  assert.match(deployment, /COPY pi\/package\.json pi\/package-lock\.json/);
  assert.match(deployment, /COPY pi\/packages \.\/packages/);
  assert.match(deployment, /npm pack --workspace packages\/coding-agent/);
  assert.match(deployment, /org\.opencontainers\.image\.pi-source="git-submodule"/);
  assert.match(deployment, /PI_BIN=\/opt\/pi\/node_modules\/\.bin\/pi/);
  assert.match(deployment, /RUN PI_SQLITE_TEST_BIN="\$PI_BIN" npm test/);
  assert.match(deployment, /PERSISTENT_STORE=sqlite/);
  assert.doesNotMatch(deployment, /PI_PACKAGE_SPEC|published-package|PERSISTENT_STORE=jsonl/);
  assert.doesNotMatch(deployment, /PI_SQLITE_CONTRACT_TEST=skip/);
});

test("local SQLite Docker build requires and packages the named pi source context", () => {
  assert.match(local, /FROM scratch AS pi-source/);
  assert.match(local, /COPY --from=pi-source \/packages \.\/packages/);
  assert.match(local, /npm pack --workspace packages\/coding-agent/);
  assert.match(local, /PI_BIN=\/opt\/pi\/node_modules\/\.bin\/pi/);
  assert.match(local, /PERSISTENT_STORE=sqlite/);
  assert.match(local, /org\.opencontainers\.image\.pi-revision="\$\{PI_LOCAL_REV\}"/);
  assert.match(local, /FROM node:22-slim/);
});

test("clean pi builds hydrate generated AI model data through the package build", () => {
  assert.match(packageJson.scripts["build:pi"], /npm run build --workspace packages\/ai/);
  assert.doesNotMatch(packageJson.scripts["build:pi"], /tsgo -p packages\/ai/);
  assert.match(local, /rm -rf packages\/ai\/src\/providers\/data[\s\S]*npm run build --workspace packages\/ai/);
  assert.doesNotMatch(local, /tsgo -p packages\/ai/);
});

test("both runtime images include hublot, Git server, and Claude Code dependencies", () => {
  assert.match(deployment, /procps ripgrep lsof python3/);
  assert.match(local, /procps ripgrep lsof python3/);
  assert.match(deployment, /@anthropic-ai\/claude-code@2\.1\.251/);
  assert.match(local, /@anthropic-ai\/claude-code@2\.1\.251/);
  assert.match(deployment, /claude --version \| grep -q '\^2\\\.1\\\.251 '/);
  assert.match(local, /claude --version \| grep -q '\^2\\\.1\\\.251 '/);
  assert.match(deployment, /COPY extensions \.\/extensions/);
  assert.match(local, /COPY extensions \.\/extensions/);
});

test("both runtime images create PI_DIR before running build-time tests", () => {
  for (const dockerfile of [deployment, local]) {
    assert.ok(dockerfile.indexOf("RUN mkdir -p /workspace") < dockerfile.indexOf("npm test"));
  }
});

test("local-source build documentation pins context, revision, and version", () => {
  assert.match(containerDocs, /docker build -f Dockerfile\.local-pi/);
  assert.match(containerDocs, /--build-context pi-source=\.\/pi/);
  assert.match(containerDocs, /--build-arg PI_LOCAL_REV=/);
  assert.match(containerDocs, /--build-arg PI_LOCAL_VERSION=0\.80\.7/);
});
