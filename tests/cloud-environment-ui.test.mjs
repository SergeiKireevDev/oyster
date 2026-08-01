import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("Hub environment selector creates workspaces in the selected connection environment", () => {
  const sidebar = component("SessionSidebar.svelte");
  const registry = readFileSync(new URL("../public/src/runtime/modalContentRegistry.js", import.meta.url), "utf8");
  assert.match(sidebar, /class="session-sidebar-environment-create"/);
  assert.match(sidebar, /selectedEnvironment\?\.kind === "llmbox"/);
  assert.match(sidebar, /content: "llmboxWorkspace"/);
  assert.match(sidebar, /context: \{ spoke: selectedEnvironment\.spoke \|\| selectedEnvironment\.environmentId/);
  assert.match(sidebar, /content: "cloudWorkspace"/);
  assert.match(sidebar, /providerId: selectedEnvironment\?\.kind === "cloud"/);
  assert.match(sidebar, /Connect cloud provider/);
  assert.match(registry, /cloudWorkspace: CloudWorkspaceModal/);
  assert.match(registry, /llmboxWorkspace: LlmboxWorkspaceModal/);
  assert.match(registry, /content === "cloudWorkspace"[\s\S]*providerId: context\?\.providerId/);
  assert.match(registry, /content === "llmboxWorkspace"[\s\S]*spoke: context\?\.spoke[\s\S]*environmentName: context\?\.environmentName/);
});

test("environment information describes connection boundaries rather than VM instances", () => {
  const sidebar = component("SessionSidebar.svelte");
  assert.match(sidebar, /\.\.\.environment,[\s\S]*environmentId: environment\.id/);
  assert.match(sidebar, /function chooseEnvironment\(event\)[\s\S]*requestedEnvironmentId = event\.currentTarget\.value;[\s\S]*closeEnvironmentInfo\(\)/);
  assert.match(sidebar, /function toggleEnvironmentInfo\(\)[\s\S]*environmentInfoOpen = true/);
  assert.match(sidebar, /selectedEnvironment\.environmentId === environmentInfoEnvironmentId/);
  assert.match(sidebar, /function environmentInfo\(environment\)/);
  for (const label of ["Environment ID", "Type", "Status", "Provider", "Connection", "Spoke", "Default", "Workspaces"]) {
    assert.match(sidebar, new RegExp(`\\["${label}"`));
  }
  assert.match(sidebar, /Direct Hub connection/);
  assert.match(sidebar, /llmbox spoke/);
  assert.doesNotMatch(sidebar, /Estimated VM cost|Instance ID|Provider state/);
  assert.match(sidebar, /Close environment information/);
});

test("cloud workspace modal provisions source-installed reverse-connected Oyster VMs", () => {
  const source = component("CloudWorkspaceModal.svelte");
  assert.match(source, /export let providerId = ""/);
  assert.match(source, /providers\.find\(\(candidate\) => candidate\.id === providerId\)/);
  assert.match(source, /getWorkspaceService\(\)/);
  assert.match(source, /workspaceService\.listCloudProviders\(\)/);
  assert.match(source, /workspaceService\.saveCloudCredentials\(selectedProvider\.id/);
  assert.match(source, /workspaceService\.getCloudOptions\(requestedProviderId, requestedRegion\)/);
  assert.match(source, /workspaceService\.provisionCloudWorkspace\(\{/);
  assert.doesNotMatch(source, /\bfetch\s*\(|["'`]\/api\//);
  assert.match(source, /createdWorkspace\.environmentName/);
  assert.match(source, /providerId === "digitalocean"/);
  assert.match(source, /providerId === "hetzner" \? "HZ"/);
  assert.match(source, /providerId === "aws" \? "AWS"/);
  assert.match(source, /Sign in with DigitalOcean|oauth_redirect/);
  assert.match(source, /Sign in with Google|Choose a project/);
  assert.match(source, /Connect AWS account|assume_role/);
  assert.match(source, /Create Hetzner API token|Open Hetzner API tokens/);
  assert.match(source, /Advanced connection options/);
  assert.match(source, /type="file"/);
  assert.match(source, /cloudBrowser\.navigate/);
  assert.match(source, /installs Oyster from source with cloud-init/);
  assert.match(source, /configured Oyster source/);
  assert.match(source, /registers this VM with Hub over outbound WSS/);
  assert.match(source, /appears immediately as awaiting agent/);
  assert.doesNotMatch(source, /cloud-init are not installed|raw VM will be created/);
  assert.match(source, /class="btn cloud-primary wide" type="submit" disabled=\{loading\}/);
  assert.doesNotMatch(source, /disabled=\{loading \|\| !provisionComplete\}/);
  assert.match(source, /select value=\{size\} onchange=\{\(event\) => changeSize/);
  assert.match(source, /imageAvailableForSelection/);
  assert.match(source, /\["digitalocean", "hetzner"\]\.includes/);
  assert.match(source, /Available in: \{selectedSizeAvailability\}/);
  assert.match(source, /size is not available in this region/);
  assert.match(source, /regionAvailability\(selectedSize\)/);
  assert.match(source, /no currently available regions reported by DigitalOcean/);
  assert.match(source, /sizeAvailableInRegion\(item, region\)/);
  assert.match(source, /data-modal-cancel/);
  assert.doesNotMatch(source, /window\.dispatchEvent|localStorage/);
});

test("llmbox workspace modal creates a box in the selected spoke environment", () => {
  const source = component("LlmboxWorkspaceModal.svelte");
  assert.match(source, /let \{ spoke = "", environmentName = "" \} = \$props\(\)/);
  assert.match(source, /workspaceService\.createLlmboxWorkspace\(payload\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(|["'`]\/api\//);
  assert.match(source, /const id = workspaceId\.trim\(\)/);
  assert.match(source, /name: workspaceName\.trim\(\) \|\| id/);
  assert.match(source, /spoke,/);
  assert.match(source, /diskGiB \* BYTES_PER_GIB/);
  assert.match(source, /publishWorkspace\(workspace\)/);
});

test("llmbox workspace creation owns async and validation state safely", () => {
  const source = component("LlmboxWorkspaceModal.svelte");
  assert.match(source, /if \(loading\) return;/);
  assert.match(source, /cause instanceof Error && cause\.message/);
  assert.match(source, /onDestroy\(\(\) => createRequests\.invalidate\(\)\)/);
  assert.match(source, /Math\.floor\(Number\.MAX_SAFE_INTEGER \/ BYTES_PER_GIB\)/);
  assert.match(source, /aria-busy=\{loading\}/);
  assert.match(source, /aria-describedby=\{error \? "llmboxWorkspaceError" : undefined\}/);
  assert.match(source, /id="llmboxWorkspaceError"[^>]*role="alert"[^>]*aria-atomic="true"/);
  assert.match(source, /oninput=\{clearError\}/);
  assert.match(source, /disabled=\{loading\}/);
  assert.match(source, /<span role="status">Creating workspace…<\/span>/);
});
