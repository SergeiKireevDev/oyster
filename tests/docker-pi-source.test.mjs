import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fallback = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const local = readFileSync(new URL("../Dockerfile.local-pi", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("published Docker fallback is explicit and version-labelled", () => {
  assert.match(fallback, /ARG PI_PACKAGE_SPEC=@earendil-works\/pi-coding-agent@0\.80\.3/);
  assert.match(fallback, /org\.opencontainers\.image\.pi-source="published-package"/);
  assert.match(fallback, /org\.opencontainers\.image\.pi-version="\$\{PI_PACKAGE_VERSION\}"/);
  assert.doesNotMatch(fallback, /npm install -g @earendil-works\/pi-coding-agent/);
  assert.match(fallback, /PERSISTENT_STORE=jsonl/);
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

test("both runtime images include lsof for restart-safe hublot PID discovery", () => {
  assert.match(fallback, /procps ripgrep lsof/);
  assert.match(local, /procps ripgrep lsof/);
});

test("local-source build command pins context, revision, and version", () => {
  assert.match(readme, /docker build -f Dockerfile\.local-pi/);
  assert.match(readme, /--build-context pi-source=\/home\/ubuntu\/pi-coding-agent/);
  assert.match(readme, /--build-arg PI_LOCAL_REV=/);
  assert.match(readme, /--build-arg PI_LOCAL_VERSION=0\.80\.6/);
});
