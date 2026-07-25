import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createCloudProvisioningService } from "../oyster-hub/cloud-provisioning.mjs";
import { createOysterHub } from "../oyster-hub/app.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function xmlResponse(value, status = 200) {
  return new Response(value, { status, headers: { "content-type": "text/xml" } });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("DigitalOcean credentials, live options, and provisioned environments persist without secret disclosure", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-cloud-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateFile = join(root, "cloud-state.json");
  const calls = [];
  let bootstrapSecret;
  const canary = "dop_v1_cloud_secret_canary";
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.headers.authorization, `Bearer ${canary}`);
    if (String(url).includes("/regions")) return jsonResponse({ regions: [{ slug: "nyc3", name: "New York 3", available: true }, { slug: "old", name: "Old", available: false }] });
    if (String(url).includes("/sizes")) return jsonResponse({ sizes: [
      { slug: "s-1vcpu-1gb", available: true, vcpus: 1, memory: 1024, price_monthly: 6, regions: ["nyc3"] },
      { slug: "gpu-unavailable", available: true, vcpus: 8, memory: 640000, price_monthly: 999, regions: [] },
    ] });
    if (String(url).includes("/images")) return jsonResponse({ images: [{ slug: "ubuntu-24-04-x64", status: "available", description: "Ubuntu 24.04", distribution: "Ubuntu", regions: ["nyc3"] }] });
    if (String(url).includes("/tags?")) return jsonResponse({ tags: [{ name: "oyster-hub" }] });
    if (String(url).endsWith("/droplets/451/actions")) {
      const type = JSON.parse(options.body).type;
      assert.ok(["power_off", "power_on"].includes(type));
      return jsonResponse({ action: { status: "in-progress" } }, 201);
    }
    if (String(url).endsWith("/droplets/451") && options.method === "DELETE") return new Response(null, { status: 204 });
    if (String(url).endsWith("/droplets")) {
      const body = JSON.parse(options.body);
      assert.deepEqual({ name: body.name, region: body.region, size: body.size, image: body.image }, { name: "cloud-dev", region: "nyc3", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64" });
      assert.match(body.user_data, /^#cloud-config\n/);
      const agentEnvironment = Buffer.from(body.user_data.match(/content: ([A-Za-z0-9+/=]+)/)[1], "base64").toString("utf8");
      assert.match(agentEnvironment, /wss:\/\/hub\.get-oyster\.dev\/box\/connect/);
      bootstrapSecret = agentEnvironment.match(/OYSTER_BOX_BOOTSTRAP_SECRET="([^"]+)"/)[1];
      assert.deepEqual(body.tags, ["oyster-hub"]);
      return jsonResponse({ droplet: { id: 451, status: "new" }, links: { actions: [{ href: "https://api.digitalocean.com/v2/actions/9" }] } }, 202);
    }
    throw new Error(`unexpected request ${url}`);
  };
  const service = createCloudProvisioningService({ stateFile, fetchImpl });

  const initial = await service.listProviders();
  assert.deepEqual(initial.map(({ id, configured }) => [id, configured]), [["digitalocean", false], ["hetzner", false], ["aws", false], ["gcp", false]]);
  assert.equal(JSON.stringify(initial).includes(canary), false);
  assert.equal((await service.configure("digitalocean", { token: canary })).configured, true);
  const providers = await service.listProviders();
  assert.equal(providers.find(({ id }) => id === "digitalocean").configured, true);
  assert.equal(JSON.stringify(providers).includes(canary), false);

  const options = await service.options("digitalocean");
  assert.deepEqual(options.regions, [{ id: "nyc3", name: "New York 3" }]);
  assert.equal(options.defaults.size, "s-1vcpu-1gb");
  assert.deepEqual(options.sizes.map(({ id }) => id), ["s-1vcpu-1gb"], "sizes with no DigitalOcean regions are not orderable");
  assert.equal(options.defaults.image, "ubuntu-24-04-x64");
  const environment = await service.provision({ provider: "digitalocean", name: "Cloud-Dev", region: "nyc3", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64" });
  assert.deepEqual(environment, {
    id: "digitalocean-451",
    name: "Cloud-Dev",
    status: "awaiting_agent",
    local: false,
    cloud: true,
    createdAt: environment.createdAt,
    provider: {
      id: "digitalocean", name: "DigitalOcean", instanceId: "451", state: "new", region: "nyc3", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64",
      consoleUrl: "https://cloud.digitalocean.com/droplets/451",
      generation: environment.provider.generation,
      registrationStatus: "awaiting_agent",
      lastSeenAt: null,
    },
  });
  assert.equal(JSON.stringify(environment).includes(canary), false);
  assert.equal(statSync(stateFile).mode & 0o777, 0o600);
  assert.match(readFileSync(stateFile, "utf8"), new RegExp(canary));
  assert.equal(readFileSync(stateFile, "utf8").includes(bootstrapSecret), false);

  const legacyState = JSON.parse(readFileSync(stateFile, "utf8"));
  legacyState.environments[0].provider.consoleUrl = "/v2/actions/legacy-relative-link";
  writeFileSync(stateFile, JSON.stringify(legacyState));
  const restored = createCloudProvisioningService({ stateFile, fetchImpl });
  const restoredEnvironments = await restored.listEnvironments();
  assert.deepEqual(restoredEnvironments.map(({ id }) => id), ["digitalocean-451"]);
  assert.equal(restoredEnvironments[0].provider.consoleUrl, "https://cloud.digitalocean.com/droplets/451");
  const [workspace] = await restored.listWorkspaces();
  assert.equal(workspace.id, "digitalocean-451");
  assert.equal(workspace.status, "awaiting_agent");
  assert.equal(workspace.provider.directAgent, true);
  assert.equal((await restored.pause("digitalocean-451")).status, "paused");
  assert.equal((await restored.resume("digitalocean-451")).status, "resuming");
  assert.deepEqual(await restored.destroy("digitalocean-451"), { id: "digitalocean-451", name: "Cloud-Dev", destroyed: true });
  await restored.removeCredentials("digitalocean");
  assert.equal((await restored.listProviders()).find(({ id }) => id === "digitalocean").configured, false);
  assert.deepEqual((await restored.listEnvironments()).map(({ id }) => id), []);
  assert.equal(calls.length, 8);
  assert.equal(calls.some(({ url }) => String(url).endsWith("/tags")), false, "an existing ownership tag does not require tag:create");
});

test("DigitalOcean explicitly creates one stable ownership tag when it is absent", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push([target, options.method || "GET", options.body ? JSON.parse(options.body) : null]);
    if (target.includes("/tags?")) return jsonResponse({ tags: [] });
    if (target.endsWith("/tags")) return jsonResponse({ tag: { name: "oyster-hub" } }, 201);
    if (target.endsWith("/droplets")) return jsonResponse({ droplet: { id: 99, status: "new" } }, 202);
    throw new Error(`unexpected request ${target}`);
  };
  const service = createCloudProvisioningService({ fetchImpl });
  await service.configure("digitalocean", { token: "test-token" });
  await service.provision({ provider: "digitalocean", name: "tagged-box", region: "nyc3", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64" });
  assert.deepEqual(calls.map(([, method, body]) => [method, body?.name, body?.tags]), [
    ["GET", undefined, undefined],
    ["POST", "oyster-hub", undefined],
    ["POST", "tagged-box", ["oyster-hub"]],
  ]);
});

test("AWS options and EC2 provisioning use signed provider API requests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = new URLSearchParams(options.body);
    const action = body.get("Action");
    calls.push({ url: String(url), action, headers: options.headers, body });
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
    assert.equal(String(options.headers.authorization).includes("aws-secret-canary"), false);
    if (action === "DescribeRegions") return xmlResponse("<DescribeRegionsResponse><regionInfo><item><regionName>us-east-1</regionName></item><item><regionName>eu-west-1</regionName></item></regionInfo></DescribeRegionsResponse>");
    if (action === "DescribeInstanceTypeOfferings") return xmlResponse("<DescribeInstanceTypeOfferingsResponse><instanceTypeOfferingSet><item><instanceType>t3.micro</instanceType></item><item><instanceType>m7i.large</instanceType></item></instanceTypeOfferingSet></DescribeInstanceTypeOfferingsResponse>");
    if (action === "DescribeImages") return xmlResponse("<DescribeImagesResponse><imagesSet><item><imageId>ami-new</imageId><name>al2023-new</name><description>Amazon Linux</description><creationDate>2026-01-01T00:00:00Z</creationDate></item></imagesSet></DescribeImagesResponse>");
    if (action === "RunInstances") return xmlResponse("<RunInstancesResponse><instancesSet><item><instanceId>i-123abc</instanceId><instanceState><name>pending</name></instanceState></item></instancesSet></RunInstancesResponse>");
    if (["StopInstances", "StartInstances", "TerminateInstances"].includes(action)) return xmlResponse(`<${action}Response><instancesSet><item><currentState><name>pending</name></currentState></item></instancesSet></${action}Response>`);
    throw new Error(`unexpected AWS action ${action}`);
  };
  const service = createCloudProvisioningService({ fetchImpl });
  await service.configure("aws", { accessKeyId: "AKIATEST", secretAccessKey: "aws-secret-canary", defaultRegion: "us-east-1" });
  const options = await service.options("aws", { region: "eu-west-1" });
  assert.equal(options.defaults.region, "eu-west-1");
  assert.deepEqual(options.sizes.map(({ id }) => id), ["m7i.large", "t3.micro"]);
  assert.deepEqual(options.images.map(({ id }) => id), ["ami-new"]);
  const environment = await service.provision({ provider: "aws", name: "build-node", region: "eu-west-1", size: "t3.micro", image: "ami-new" });
  assert.equal(environment.provider.instanceId, "i-123abc");
  assert.equal(environment.provider.state, "pending");
  assert.equal(calls.at(-1).body.get("TagSpecification.1.Tag.1.Value"), "build-node");
  assert.equal(calls.at(-1).body.get("TagSpecification.1.Tag.2.Value"), "oyster-hub");
  const compressedUserData = Buffer.from(calls.at(-1).body.get("UserData"), "base64");
  assert.ok(compressedUserData.length < 16 * 1024, "EC2 user data must fit the decoded 16 KiB provider limit");
  assert.match(gunzipSync(compressedUserData).toString("utf8"), /^#cloud-config\n/);
  assert.equal((await service.pause(environment.id)).status, "paused");
  assert.equal((await service.resume(environment.id)).status, "resuming");
  assert.equal((await service.destroy(environment.id)).destroyed, true);
  assert.deepEqual(calls.map(({ action }) => action), ["DescribeRegions", "DescribeInstanceTypeOfferings", "DescribeImages", "RunInstances", "StopInstances", "StartInstances", "TerminateInstances"]);
});

test("GCP exchanges a service-account JWT for OAuth and provisions from live Compute Engine options", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccountJson = JSON.stringify({
    project_id: "oyster-test-project",
    client_email: "oyster@oyster-test-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(form.get("assertion").split(".").length, 3);
      return jsonResponse({ access_token: "gcp-oauth-canary", expires_in: 3600, token_type: "Bearer" });
    }
    assert.equal(options.headers.authorization, "Bearer gcp-oauth-canary");
    if (target.includes("/oyster-test-project/zones?")) return jsonResponse({ items: [{ name: "us-central1-a", status: "UP", description: "Iowa" }] });
    if (target.includes("/ubuntu-os-cloud/global/images?")) return jsonResponse({ items: [{ name: "ubuntu-2404-noble-v1", status: "READY", description: "Ubuntu 24.04" }] });
    if (target.includes("/zones/us-central1-a/machineTypes?")) return jsonResponse({ items: [{ name: "e2-micro", guestCpus: 2, memoryMb: 1024 }] });
    if (target.endsWith("/zones/us-central1-a/instances/gcp-node/stop")) return jsonResponse({ status: "PENDING" });
    if (target.endsWith("/zones/us-central1-a/instances/gcp-node/start")) return jsonResponse({ status: "PENDING" });
    if (target.endsWith("/zones/us-central1-a/instances/gcp-node") && options.method === "DELETE") return jsonResponse({ status: "PENDING" });
    if (target.endsWith("/zones/us-central1-a/instances")) {
      const body = JSON.parse(options.body);
      assert.equal(body.machineType, "zones/us-central1-a/machineTypes/e2-micro");
      assert.equal(body.disks[0].initializeParams.sourceImage, "projects/ubuntu-os-cloud/global/images/ubuntu-2404-noble-v1");
      assert.equal(body.labels.managed_by, "oyster-hub");
      assert.match(body.metadata.items.find(({ key }) => key === "user-data").value, /^#cloud-config\n/);
      return jsonResponse({ targetId: "887766", status: "PENDING" });
    }
    throw new Error(`unexpected GCP request ${target}`);
  };
  const service = createCloudProvisioningService({ fetchImpl });
  const configured = await service.configure("gcp", { serviceAccountJson });
  assert.equal(configured.account, "oyster@oyster-test-project.iam.gserviceaccount.com · oyster-test-project");
  const options = await service.options("gcp");
  assert.deepEqual(options.regions.map(({ id }) => id), ["us-central1-a"]);
  assert.deepEqual(options.sizes.map(({ id }) => id), ["e2-micro"]);
  assert.deepEqual(options.images.map(({ id }) => id), ["ubuntu-2404-noble-v1"]);
  const environment = await service.provision({ provider: "gcp", name: "gcp-node", region: "us-central1-a", size: "e2-micro", image: "ubuntu-2404-noble-v1" });
  assert.equal(environment.provider.instanceId, "887766");
  assert.equal(environment.provider.state, "PENDING");
  assert.equal(JSON.stringify(await service.listProviders()).includes("PRIVATE KEY"), false);
  assert.equal((await service.pause(environment.id)).status, "paused");
  assert.equal((await service.resume(environment.id)).status, "resuming");
  assert.equal((await service.destroy(environment.id)).destroyed, true);
  assert.equal(calls.filter(({ target }) => target === "https://oauth2.googleapis.com/token").length, 7);
});

test("Hetzner Cloud credentials, live options, and provisioning use standard REST with Bearer auth", async () => {
  const calls = [];
  const canary = "HCLOUD_test_secret_canary";
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
    assert.equal(options.headers.authorization, `Bearer ${canary}`);
    if (String(url).includes("/locations")) return jsonResponse({ locations: [
      { id: 2, name: "nbg1", description: "Nuremberg", country: "DE" },
      { id: 3, name: "fsn1", description: "Falkenstein", country: "DE" },
      { id: 1, name: "hel1", description: "Helsinki", country: "FI" },
    ] });
    if (String(url).includes("/server_types")) return jsonResponse({ server_types: [
      { id: 22, name: "cx22", cores: 2, memory: 4, architecture: "x86", prices: [{ location: "nbg1", price_monthly: { net: "4.99" } }], locations: [
        { name: "nbg1", available: true, deprecation: null },
        { name: "fsn1", available: true, deprecation: null },
      ] },
      { id: 32, name: "cx32", cores: 4, memory: 8, architecture: "x86", prices: [{ location: "nbg1", price_monthly: { net: "9.99" } }], locations: [
        { name: "nbg1", available: false, deprecation: null },
      ] },
      { id: 42, name: "cax21", cores: 4, memory: 8, architecture: "arm", prices: [{ location: "hel1", price_monthly: { net: "7.99" } }], locations: [
        { name: "hel1", available: true, deprecation: null },
      ] },
    ] });
    if (String(url).includes("/images")) return jsonResponse({ images: [
      { id: 12345, name: "ubuntu-24.04", description: "Ubuntu 24.04 x86", os_flavor: "ubuntu", type: "system", status: "available", architecture: "x86" },
      { id: 12346, name: "ubuntu-24.04", description: "Ubuntu 24.04 Arm", os_flavor: "ubuntu", type: "system", status: "available", architecture: "arm" },
      { id: 67890, name: "debian-12", description: "Debian 12 Standard", os_flavor: "debian", type: "system", status: "available", architecture: "x86" },
    ] });
    if (String(url).includes("/servers/1001/actions/shutdown")) return jsonResponse({ action: { status: "running" } }, 201);
    if (String(url).includes("/servers/1001/actions/poweron")) return jsonResponse({ action: { status: "success" } }, 201);
    if (String(url).includes("/servers/1001") && options.method === "DELETE") return new Response(null, { status: 204 });
    if (String(url).endsWith("/servers") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.server_type, "cx22");
      assert.equal(body.location, "nbg1");
      assert.equal(body.image, "12345");
      assert.equal(body.labels["managed-by"], "oyster-hub");
      assert.equal(body.labels["oyster-box-id"], "hetzner-node");
      assert.ok(Object.keys(body.labels).every((key) => /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$/.test(key)), "Hetzner label keys are valid");
      assert.match(body.user_data, /^#cloud-config\n/);
      assert.ok(Buffer.byteLength(body.user_data) <= 32 * 1024, "Hetzner user data must fit its 32 KiB limit");
      return jsonResponse({ server: { id: 1001, status: "starting", public_net: { ipv4: { ip: "159.69.123.45" } } } }, 201);
    }
    throw new Error(`unexpected Hetzner request ${url}`);
  };
  const service = createCloudProvisioningService({ fetchImpl });

  await service.configure("hetzner", { token: canary });
  const options = await service.options("hetzner");
  assert.deepEqual(options.regions.map(({ id }) => id), ["nbg1", "fsn1", "hel1"]);
  assert.equal(options.regions[0].name.includes("Nuremberg"), true);
  assert.deepEqual(options.sizes.filter((item) => item.regions.includes("nbg1")).map(({ id }) => id), ["cx22"], "temporarily unavailable types are excluded");
  assert.equal(options.sizes.find(({ id }) => id === "cax21").architecture, "arm");
  assert.deepEqual(options.images.map(({ id, architecture }) => [id, architecture]), [["12345", "x86"], ["12346", "arm"]]);
  assert.equal(options.defaults.size, "cx22");
  assert.equal(options.defaults.image, "12345");

  const environment = await service.provision({ provider: "hetzner", name: "hetzner-node", region: "nbg1", size: "cx22", image: "12345" });
  assert.equal(environment.provider.instanceId, "1001");
  assert.equal(environment.provider.state, "starting");
  assert.equal(environment.provider.consoleUrl, "https://console.hetzner.cloud/");
  assert.equal(JSON.stringify(environment).includes(canary), false);

  assert.equal((await service.pause(environment.id)).status, "paused");
  assert.equal((await service.resume(environment.id)).status, "resuming");
  assert.equal((await service.destroy(environment.id)).destroyed, true);
  assert.deepEqual(calls.map(({ url, method }) => [method, String(url).split("/v1")[1]]), [
    ["GET", "/locations?per_page=100"],
    ["GET", "/server_types?per_page=100"],
    ["GET", "/images?type=system&sort=name&per_page=100"],
    ["POST", "/servers"],
    ["POST", "/servers/1001/actions/shutdown"],
    ["POST", "/servers/1001/actions/poweron"],
    ["DELETE", "/servers/1001"],
  ]);
});

test("Hetzner Cloud secrets are never exposed through provider listings", async () => {
  const canary = "HCLOUD_listing_canary";
  const fetchImpl = async () => jsonResponse({ locations: [], server_types: [], images: [] });
  const service = createCloudProvisioningService({ fetchImpl });
  await service.configure("hetzner", { token: canary });
  const providers = await service.listProviders();
  const hetzner = providers.find(({ id }) => id === "hetzner");
  assert.equal(hetzner.configured, true);
  assert.equal(hetzner.account, null);
  assert.equal(JSON.stringify(providers).includes(canary), false);
});

test("cloud credential encryption migrates provider secrets out of plaintext state", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-cloud-encrypted-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateFile = join(root, "cloud-state.json");
  const service = createCloudProvisioningService({ stateFile, credentialEncryptionKey: "test-envelope-key" });
  await service.configure("hetzner", { token: "HCLOUD_encrypted_canary" });
  const persisted = readFileSync(stateFile, "utf8");
  assert.equal(persisted.includes("HCLOUD_encrypted_canary"), false);
  assert.match(persisted, /encryptedCredentials/);
  const restored = createCloudProvisioningService({ stateFile, credentialEncryptionKey: "test-envelope-key" });
  assert.equal((await restored.listProviders()).find(({ id }) => id === "hetzner").configured, true);
  const missingKey = createCloudProvisioningService({ stateFile });
  await assert.rejects(missingKey.listProviders(), /no credential key is configured/);
});

test("Google OAuth credentials list projects and complete authenticated device handoff", async () => {
  const calls = [];
  const service = createCloudProvisioningService({
    fetchImpl: async (url, options = {}) => {
      calls.push([String(url), options]);
      return jsonResponse({ projects: [{ projectId: "mobile-project", name: "Mobile", lifecycleState: "ACTIVE" }] });
    },
  });
  await service.configureOAuth("gcp", {
    kind: "oauth", accessToken: "google-access-canary", refreshToken: "google-refresh-canary",
    expiresAt: Date.now() + 3600_000, account: "owner@example.com", projectId: null,
  });
  assert.deepEqual(await service.listProjects("gcp"), [{ id: "mobile-project", name: "Mobile" }]);
  assert.equal(calls[0][1].headers.authorization, "Bearer google-access-canary");
  await service.selectProject("gcp", "mobile-project");
  assert.equal((await service.listProviders()).find(({ id }) => id === "gcp").requiresProject, false);

  const handoff = await service.startHandoff("hetzner");
  assert.equal((await service.handoffStatus(handoff.id)).status, "waiting");
  await service.configure("hetzner", { token: "HCLOUD_handoff_canary", handoffId: handoff.id });
  assert.equal((await service.handoffStatus(handoff.id)).status, "succeeded");
  const cancelled = await service.startHandoff("gcp");
  assert.equal((await service.cancelHandoff(cancelled.id)).status, "cancelled");
});

test("expired provider OAuth credentials refresh once across concurrent requests", async () => {
  let refreshes = 0;
  const service = createCloudProvisioningService({
    oauth: { gcp: { clientId: "google-id", clientSecret: "google-secret", redirectUrl: "https://hub.example/cloud/oauth/gcp/callback" } },
    fetchImpl: async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ access_token: "fresh-access", expires_in: 3600 });
      }
      return jsonResponse({ projects: [] });
    },
  });
  await service.configureOAuth("gcp", {
    kind: "oauth", accessToken: "expired", refreshToken: "refresh-canary", expiresAt: Date.now() - 1,
    account: "owner@example.com", projectId: null,
  });
  await Promise.all([service.listProjects("gcp"), service.listProjects("gcp")]);
  assert.equal(refreshes, 1);
});

test("AWS role onboarding generates CloudFormation setup and verifies with temporary STS credentials", async () => {
  const calls = [];
  const service = createCloudProvisioningService({
    aws: {
      sourceAccessKeyId: "AKIAHUB", sourceSecretAccessKey: "hub-secret", principalArn: "arn:aws:iam::111122223333:role/Hub",
      cloudFormationTemplateUrl: "https://assets.example/oyster-role.yaml", roleName: "OysterHubRole",
    },
    fetchImpl: async (url, options) => {
      const body = new URLSearchParams(options.body);
      calls.push([String(url), body, options.headers]);
      assert.equal(body.get("Action"), "AssumeRole");
      assert.match(options.headers.authorization, /Credential=AKIAHUB/);
      return xmlResponse("<AssumeRoleResponse><Credentials><AccessKeyId>ASIATEMP</AccessKeyId><SecretAccessKey>temporary-secret</SecretAccessKey><SessionToken>temporary-session</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResponse>");
    },
  });
  const flow = await service.startAwsRole("123456789012");
  assert.match(flow.setupUrl, /cloudformation/);
  assert.match(flow.setupUrl, /ExternalId/);
  const verified = await service.verifyAwsRole(flow.id);
  assert.equal(verified.status, "succeeded");
  const aws = (await service.listProviders()).find(({ id }) => id === "aws");
  assert.equal(aws.credentialType, "assume_role");
  assert.equal(aws.account, "arn:aws:iam::123456789012:role/OysterHubRole");
  assert.equal(calls.length, 1);
});

test("Hub cloud authorization routes require API auth while provider callback remains one-time public", async (t) => {
  const calls = [];
  const authorizationService = {
    start(provider) { calls.push(["start", provider]); return { id: "flow-1", provider, status: "authorizing", authorizationUrl: "https://provider.example/auth" }; },
    status(id) { calls.push(["status", id]); return { id, provider: "digitalocean", status: "succeeded" }; },
    cancel(id) { calls.push(["cancel", id]); return { id, status: "cancelled" }; },
    async callback(provider, parameters) { calls.push(["callback", provider, parameters.state, parameters.code]); return { id: "flow-1", status: "succeeded" }; },
  };
  const cloudService = {
    async listProviders() { return []; }, async listEnvironments() { return []; }, async listWorkspaces() { return []; },
  };
  const driver = {
    type: "test", endpoint: "memory://driver", capabilities: { list: true, create: false, remove: false },
    async listEnvironments() { return []; }, async listWorkspaces() { return []; }, async getWorkspace() { return null; },
  };
  const config = { token: "hub-secret", timeoutMs: 1000, driver, cloud: { stateFile: null, publicUrl: "https://hub.example" } };
  const server = createOysterHub(config, { driver, cloudService, authorizationService, logger: { error() {} } });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  assert.equal((await fetch(`${baseUrl}/api/v1/cloud/providers/digitalocean/authorization/start`, { method: "POST" })).status, 401);
  const started = await fetch(`${baseUrl}/api/v1/cloud/providers/digitalocean/authorization/start`, { method: "POST", headers: { "x-auth-token": "hub-secret" } });
  assert.equal(started.status, 202);
  const callback = await fetch(`${baseUrl}/cloud/oauth/digitalocean/callback?state=one-use&code=secret-code`, { redirect: "manual" });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), "https://hub.example/?cloud-connect=flow-1");
  assert.deepEqual(calls, [["start", "digitalocean"], ["callback", "digitalocean", "one-use", "secret-code"]]);
});

test("Hub cloud routes are authenticated, merge environments, and keep cloud service details scoped", async (t) => {
  const configured = [];
  const managed = [];
  const cloudService = {
    async listProviders() { return [{ id: "digitalocean", name: "DigitalOcean", configured: false, fields: [] }]; },
    async configure(provider, body) { configured.push([provider, body]); return { provider, configured: true }; },
    async removeCredentials(provider) { return { provider, configured: false }; },
    async options(provider, { region }) { return { regions: [{ id: region || "nyc3", name: "NYC" }], sizes: [], images: [], defaults: {} }; },
    async provision(body) { return { id: "digitalocean-1", name: body.name, status: "provisioned", cloud: true, local: false, provider: { id: body.provider } }; },
    async pause(id) { managed.push(["pause", id]); return { id, status: "paused" }; },
    async resume(id) { managed.push(["resume", id]); return { id, status: "resuming" }; },
    async destroy(id) { managed.push(["destroy", id]); return { id, destroyed: true }; },
    async listEnvironments() { return [{ id: "digitalocean-1", name: "Cloud", status: "awaiting_agent", cloud: true }]; },
    async listWorkspaces() { return [{ environmentId: "digitalocean-1", environmentName: "Cloud", id: "digitalocean-1", name: "Cloud", url: null, status: "awaiting_agent", provider: { type: "cloud", phase: "awaiting_agent" } }]; },
    async getWorkspace(id) { return id === "digitalocean-1" ? (await this.listWorkspaces())[0] : null; },
  };
  const driver = {
    type: "test", endpoint: "memory://driver", capabilities: { list: true, create: false, remove: false },
    async listEnvironments() { return [{ id: "local", name: "Local", status: "online", local: true }]; },
    async listWorkspaces() { return []; },
    async getWorkspace() { return null; },
  };
  const config = { token: "hub-secret", timeoutMs: 1000, driver, cloud: { stateFile: null } };
  const server = createOysterHub(config, { driver, cloudService, logger: { error() {} } });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  assert.equal((await fetch(`${baseUrl}/api/v1/cloud/providers`)).status, 401);
  const headers = { "x-auth-token": "hub-secret" };
  const providerResponse = await fetch(`${baseUrl}/api/v1/cloud/providers`, { headers });
  assert.equal(providerResponse.status, 200);
  assert.deepEqual((await providerResponse.json()).providers.map(({ id }) => id), ["digitalocean"]);
  const credentialResponse = await fetch(`${baseUrl}/api/v1/cloud/providers/digitalocean/credentials`, {
    method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ token: "canary" }),
  });
  assert.equal(credentialResponse.status, 200);
  assert.deepEqual(configured, [["digitalocean", { token: "canary" }]]);
  const optionResponse = await fetch(`${baseUrl}/api/v1/cloud/providers/digitalocean/options?region=sfo3`, { headers });
  assert.deepEqual((await optionResponse.json()).regions, [{ id: "sfo3", name: "NYC" }]);
  const createResponse = await fetch(`${baseUrl}/api/v1/environments`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ provider: "digitalocean", name: "Cloud" }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).environment.id, "digitalocean-1");
  const environments = await (await fetch(`${baseUrl}/api/v1/environments`, { headers })).json();
  assert.deepEqual(environments.environments.map(({ id }) => id), ["digitalocean-1", "local"]);
  const pauseResponse = await fetch(`${baseUrl}/api/v1/environments/digitalocean-1/actions`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }),
  });
  assert.equal((await pauseResponse.json()).environment.status, "paused");
  const resumeResponse = await fetch(`${baseUrl}/api/v1/environments/digitalocean-1/actions`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ action: "resume" }),
  });
  assert.equal((await resumeResponse.json()).environment.status, "resuming");
  const destroyResponse = await fetch(`${baseUrl}/api/v1/environments/digitalocean-1`, { method: "DELETE", headers });
  assert.equal((await destroyResponse.json()).environment.destroyed, true);
  assert.deepEqual(managed, [["pause", "digitalocean-1"], ["resume", "digitalocean-1"], ["destroy", "digitalocean-1"]]);
  const workspaces = await (await fetch(`${baseUrl}/api/v1/workspaces`, { headers })).json();
  assert.deepEqual(workspaces.workspaces.map(({ id, status }) => [id, status]), [["digitalocean-1", "awaiting_agent"]]);
});
