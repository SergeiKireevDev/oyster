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

test("cloud instance information opens explicitly and closes when switching environments", () => {
  const sidebar = component("SessionSidebar.svelte");
  assert.match(sidebar, /\.\.\.environment,[\s\S]*environmentId: environment\.id/);
  assert.match(sidebar, /function chooseEnvironment\(event\)[\s\S]*selectedEnvironmentId = event\.currentTarget\.value;[\s\S]*closeEnvironmentInfo\(\)/);
  assert.match(sidebar, /function toggleEnvironmentInfo\(\)[\s\S]*environmentInfoOpen = true/);
  assert.match(sidebar, /selectedEnvironment\.environmentId !== environmentInfoEnvironmentId/);
  assert.doesNotMatch(sidebar, /environmentInfoOpen = Boolean\(environmentOptions\.find/);
  assert.match(sidebar, /selectedEnvironment\?\.cloud/);
  assert.match(sidebar, /class="session-sidebar-instance-tooltip"/);
  for (const label of ["Environment ID", "Status", "Provider", "Instance ID", "Provider state", "Region / zone", "Instance type", "Image", "Created", "Registration", "Last seen", "Generation"]) {
    assert.match(sidebar, new RegExp(`\\["${label.replace("/", "\\/")}"`));
  }
  assert.match(sidebar, /Object\.entries\(provider\)/, "future provider metadata should also be shown");
  assert.match(sidebar, /Estimated VM cost/);
  assert.match(sidebar, /\/api\/v1\/cloud\/providers\/\$\{encodeURIComponent\(environment\.provider\?\.id\)\}\/options/);
  assert.match(sidebar, /excludes disks, network, taxes, credits, and discounts/);
  assert.match(sidebar, /Open provider console/);
  assert.match(sidebar, /Close instance information/);
});

test("cloud environment modal provisions source-installed reverse-connected Oyster VMs", () => {
  const source = component("CloudEnvironmentModal.svelte");
  assert.match(source, /\/api\/v1\/cloud\/providers/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /\/options\$\{query\}/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /body: JSON\.stringify\(\{ provider: selectedProvider\.id, name: environmentName, region, size, image \}\)/);
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
  assert.match(source, /llmbox-cloud-feature source branch/);
  assert.match(source, /wss:\/\/hub\.get-oyster\.dev\/box\/connect/);
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
