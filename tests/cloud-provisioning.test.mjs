import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    if (String(url).includes("/sizes")) return jsonResponse({ sizes: [{ slug: "s-1vcpu-1gb", available: true, vcpus: 1, memory: 1024, price_monthly: 6, regions: ["nyc3"] }] });
    if (String(url).includes("/images")) return jsonResponse({ images: [{ slug: "ubuntu-24-04-x64", status: "available", description: "Ubuntu 24.04", distribution: "Ubuntu", regions: ["nyc3"] }] });
    if (String(url).endsWith("/droplets")) {
      const body = JSON.parse(options.body);
      assert.deepEqual({ name: body.name, region: body.region, size: body.size, image: body.image }, { name: "cloud-dev", region: "nyc3", size: "s-1vcpu-1gb", image: "ubuntu-24-04-x64" });
      assert.match(body.user_data, /^#cloud-config\n/);
      const agentEnvironment = Buffer.from(body.user_data.match(/content: ([A-Za-z0-9+/=]+)/)[1], "base64").toString("utf8");
      assert.match(agentEnvironment, /wss:\/\/hub\.get-oyster\.dev\/box\/connect/);
      bootstrapSecret = agentEnvironment.match(/OYSTER_BOX_BOOTSTRAP_SECRET="([^"]+)"/)[1];
      assert.equal(body.tags[0], "oyster-hub");
      assert.match(body.tags.join(" "), /oyster-generation-/);
      return jsonResponse({ droplet: { id: 451, status: "new" }, links: { actions: [{ href: "https://api.digitalocean.com/v2/actions/9" }] } }, 202);
    }
    throw new Error(`unexpected request ${url}`);
  };
  const service = createCloudProvisioningService({ stateFile, fetchImpl });

  const initial = await service.listProviders();
  assert.deepEqual(initial.map(({ id, configured }) => [id, configured]), [["digitalocean", false], ["aws", false], ["gcp", false]]);
  assert.equal(JSON.stringify(initial).includes(canary), false);
  assert.equal((await service.configure("digitalocean", { token: canary })).configured, true);
  const providers = await service.listProviders();
  assert.equal(providers.find(({ id }) => id === "digitalocean").configured, true);
  assert.equal(JSON.stringify(providers).includes(canary), false);

  const options = await service.options("digitalocean");
  assert.deepEqual(options.regions, [{ id: "nyc3", name: "New York 3" }]);
  assert.equal(options.defaults.size, "s-1vcpu-1gb");
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
      consoleUrl: "https://api.digitalocean.com/v2/actions/9",
      generation: environment.provider.generation,
      registrationStatus: "awaiting_agent",
      lastSeenAt: null,
    },
  });
  assert.equal(JSON.stringify(environment).includes(canary), false);
  assert.equal(statSync(stateFile).mode & 0o777, 0o600);
  assert.match(readFileSync(stateFile, "utf8"), new RegExp(canary));
  assert.equal(readFileSync(stateFile, "utf8").includes(bootstrapSecret), false);

  const restored = createCloudProvisioningService({ stateFile, fetchImpl });
  assert.deepEqual((await restored.listEnvironments()).map(({ id }) => id), ["digitalocean-451"]);
  const [workspace] = await restored.listWorkspaces();
  assert.equal(workspace.id, "digitalocean-451");
  assert.equal(workspace.status, "awaiting_agent");
  assert.equal(workspace.provider.directAgent, true);
  await restored.removeCredentials("digitalocean");
  assert.equal((await restored.listProviders()).find(({ id }) => id === "digitalocean").configured, false);
  assert.deepEqual((await restored.listEnvironments()).map(({ id }) => id), ["digitalocean-451"]);
  assert.equal(calls.length, 4);
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
  assert.match(Buffer.from(calls.at(-1).body.get("UserData"), "base64").toString("utf8"), /^#cloud-config\n/);
  assert.deepEqual(calls.map(({ action }) => action), ["DescribeRegions", "DescribeInstanceTypeOfferings", "DescribeImages", "RunInstances"]);
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
  assert.equal(calls.filter(({ target }) => target === "https://oauth2.googleapis.com/token").length, 4);
});

test("Hub cloud routes are authenticated, merge environments, and keep cloud service details scoped", async (t) => {
  const configured = [];
  const cloudService = {
    async listProviders() { return [{ id: "digitalocean", name: "DigitalOcean", configured: false, fields: [] }]; },
    async configure(provider, body) { configured.push([provider, body]); return { provider, configured: true }; },
    async removeCredentials(provider) { return { provider, configured: false }; },
    async options(provider, { region }) { return { regions: [{ id: region || "nyc3", name: "NYC" }], sizes: [], images: [], defaults: {} }; },
    async provision(body) { return { id: "digitalocean-1", name: body.name, status: "provisioned", cloud: true, local: false, provider: { id: body.provider } }; },
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
  const workspaces = await (await fetch(`${baseUrl}/api/v1/workspaces`, { headers })).json();
  assert.deepEqual(workspaces.workspaces.map(({ id, status }) => [id, status]), [["digitalocean-1", "awaiting_agent"]]);
});
