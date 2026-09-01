import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("../.do/deploy.template.yaml", import.meta.url), "utf8");
const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
const workflow = existsSync(workflowUrl) ? readFileSync(workflowUrl, "utf8") : null;
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
  const deployUrl = `https://cloud.digitalocean.com/apps/new?repo=${repository}/tree/${branch}`;
  assert.ok(readme.includes(deployUrl));

  const centeredRows = [...readme.matchAll(/<p align="center">([\s\S]*?)<\/p>/g)]
    .map((match) => match[1]);
  const deployRow = centeredRows.find((row) => row.includes(deployUrl));
  assert.ok(deployRow, "Deploy to DigitalOcean button should be in a centered row");
  assert.doesNotMatch(deployRow, /badge\.svg|Node\.js|MIT license/);
});

test("CI publishes the browser-tested deployment image to public Docker Hub", { skip: workflow === null }, () => {
  assert.match(workflow, /docker\.io\/sergeikireevdev\/oyster:digitalocean/);
  assert.match(workflow, /docker\.io\/sergeikireevdev\/oyster:sha-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /docker\/login-action@v3/);
  assert.match(workflow, /registry: docker\.io/);
  assert.match(workflow, /username: \$\{\{ secrets\.DOCKERHUB_USERNAME \}\}/);
  assert.match(workflow, /password: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /ghcr\.io|secrets\.GITHUB_TOKEN|packages: write/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/feature\/digitalocean-app-platform'/);
  assert.ok(workflow.indexOf("Run mobile and desktop smoke tests") < workflow.indexOf("Publish tested deployment image"));
});

test("DigitalOcean service preserves Oyster's authenticated container contract", () => {
  assert.doesNotMatch(template, /disable_edge_cache/);
  assert.match(template, /dockerfile_path: Dockerfile/);
  assert.match(template, /http_port: 4000/);
  assert.match(template, /instance_size_slug: apps-s-2vcpu-4gb/);
  assert.doesNotMatch(template, /instance_size_slug: apps-s-1vcpu-2gb/);
  assert.match(template, /key: PI_DIR\n\s+scope: RUN_TIME\n\s+value: \/workspace/);
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
  assert.match(deploymentGuide, /setting only when the app has at least one custom domain/i);
  assert.match(deploymentGuide, /no_healthy_upstream/);
  assert.match(deploymentGuide, /exit code `137`/);
  assert.match(deploymentGuide, /does not resize an existing app/i);
});
