import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("Hub environment selector exposes the cloud provisioning modal, including an empty-fleet action", () => {
  const sidebar = component("SessionSidebar.svelte");
  const overlays = component("Overlays.svelte");
  assert.match(sidebar, /class="session-sidebar-environment-create"/);
  assert.match(sidebar, /aria-label="Provision a cloud environment"/);
  assert.match(sidebar, /\{:else if hubMode\}[\s\S]*Provision cloud environment/);
  assert.match(sidebar, /openModal\(\{ title: "New cloud environment", wide: true, content: "cloudEnvironment" \}\)/);
  assert.match(overlays, /\$modalState\.content === "cloudEnvironment"[\s\S]*<CloudEnvironmentModal \/>/);
});

test("cloud environment modal provisions source-installed reverse-connected Oyster VMs", () => {
  const source = component("CloudEnvironmentModal.svelte");
  assert.match(source, /\/api\/v1\/cloud\/providers/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /\/options\$\{query\}/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /body: JSON\.stringify\(\{ provider: selectedProvider\.id, name: environmentName, region, size, image \}\)/);
  assert.match(source, /providerId === "digitalocean"/);
  assert.match(source, /providerId === "aws" \? "AWS"/);
  assert.match(source, /OAuth 2\.0 service account/);
  assert.match(source, /selectedProvider\.id === "digitalocean"[\s\S]*tag:create[\s\S]*oyster-hub/);
  assert.match(source, /installs Oyster from source with cloud-init/);
  assert.match(source, /wss:\/\/hub\.get-oyster\.dev\/box\/connect/);
  assert.match(source, /appears immediately as awaiting agent/);
  assert.doesNotMatch(source, /cloud-init are not installed|raw VM will be created/);
  assert.match(source, /class="btn cloud-primary wide" type="submit" disabled=\{loading\}/);
  assert.doesNotMatch(source, /disabled=\{loading \|\| !provisionComplete\}/);
  assert.match(source, /select bind:value=\{size\} required/);
  assert.match(source, /Available in: \{selectedSizeAvailability\}/);
  assert.match(source, /size is not available in this region/);
  assert.match(source, /regionAvailability\(selectedSize\)/);
  assert.match(source, /no currently available regions reported by DigitalOcean/);
  assert.match(source, /sizeAvailableInRegion\(item, region\)/);
  assert.match(source, /data-modal-cancel/);
  assert.doesNotMatch(source, /window\.dispatchEvent|localStorage/);
});
