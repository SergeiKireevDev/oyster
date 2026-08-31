import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("../.do/deploy.template.yaml", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const deploymentGuide = readFileSync(
  new URL("../docs/operations/digitalocean-app-platform.md", import.meta.url),
  "utf8",
);

test("DigitalOcean deploy button and template target the deployment branch", () => {
  const repository = "https://github.com/SergeiKireevDev/oyster";
  const branch = "feature/digitalocean-app-platform";

  assert.match(template, /^spec:\n/);
  assert.ok(template.includes(`repo_clone_url: ${repository}.git`));
  assert.ok(template.includes(`branch: ${branch}`));
  assert.ok(
    readme.includes(`https://cloud.digitalocean.com/apps/new?repo=${repository}/tree/${branch}`),
  );
});

test("DigitalOcean service preserves Oyster's authenticated container contract", () => {
  assert.match(template, /dockerfile_path: Dockerfile/);
  assert.match(template, /http_port: 4000/);
  assert.match(template, /key: OYSTER_TOKEN[\s\S]*type: SECRET/);
  assert.doesNotMatch(template, /key: OYSTER_TOKEN\n\s+value:/);
  assert.match(template, /http_path: \/health/);
  assert.doesNotMatch(template, /OYSTER_UNAUTHENTICATED/);
});

test("DigitalOcean documentation discloses ephemeral storage and billing", () => {
  assert.match(deploymentGuide, /filesystem is ephemeral/i);
  assert.match(deploymentGuide, /does not support persistent volumes/i);
  assert.match(deploymentGuide, /charges continue until the app is destroyed/i);
  assert.match(deploymentGuide, /template deliberately supplies no default/i);
});
