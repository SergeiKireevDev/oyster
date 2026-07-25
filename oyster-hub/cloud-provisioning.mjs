import { createHash, createHmac, randomUUID, sign as signValue } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createOysterCloudInit, oysterCloudInitDefaults } from "./cloud-init.mjs";
import { createBoxConnectionRegistry } from "./box-registry.mjs";

const PROVIDERS = Object.freeze({
  digitalocean: Object.freeze({
    id: "digitalocean",
    name: "DigitalOcean",
    description: "Provision a Droplet with a personal access token.",
    authType: "api_token",
    oauthSupported: false,
    fields: Object.freeze([
      { id: "token", label: "Personal access token", type: "password", required: true, placeholder: "dop_v1_…" },
    ]),
  }),
  hetzner: Object.freeze({
    id: "hetzner",
    name: "Hetzner Cloud",
    description: "Provision a Cloud Server with a personal access token.",
    authType: "api_token",
    oauthSupported: false,
    fields: Object.freeze([
      { id: "token", label: "Personal access token", type: "password", required: true, placeholder: "HCLOUD_…" },
    ]),
  }),
  aws: Object.freeze({
    id: "aws",
    name: "Amazon Web Services",
    description: "Provision an EC2 instance with an IAM access key.",
    authType: "access_key",
    oauthSupported: false,
    fields: Object.freeze([
      { id: "accessKeyId", label: "Access key ID", type: "text", required: true, placeholder: "AKIA…" },
      { id: "secretAccessKey", label: "Secret access key", type: "password", required: true },
      { id: "sessionToken", label: "Session token", type: "password", required: false },
      { id: "defaultRegion", label: "Default region", type: "text", required: false, placeholder: "us-east-1" },
    ]),
  }),
  gcp: Object.freeze({
    id: "gcp",
    name: "Google Cloud",
    description: "Provision a Compute Engine VM using service-account OAuth 2.0.",
    authType: "oauth_service_account",
    oauthSupported: true,
    fields: Object.freeze([
      { id: "serviceAccountJson", label: "Service account JSON", type: "textarea", required: true, placeholder: "Paste the JSON key downloaded from Google Cloud" },
    ]),
  }),
});

export class CloudProvisioningError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "CloudProvisioningError";
    this.status = status;
  }
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new CloudProvisioningError(`${label} is required`, { status: 400 });
  return value.trim();
}

function providerDefinition(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new CloudProvisioningError(`unsupported cloud provider: ${providerId}`, { status: 404 });
  return provider;
}

function normalizeCredentials(providerId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CloudProvisioningError("credentials must be an object", { status: 400 });
  }
  if (providerId === "digitalocean" || providerId === "hetzner") return { token: required(input.token, "Personal access token") };
  if (providerId === "aws") return {
    accessKeyId: required(input.accessKeyId, "Access key ID"),
    secretAccessKey: required(input.secretAccessKey, "Secret access key"),
    sessionToken: typeof input.sessionToken === "string" ? input.sessionToken.trim() : "",
    defaultRegion: typeof input.defaultRegion === "string" ? input.defaultRegion.trim() : "",
  };
  if (providerId === "gcp") {
    let key;
    try { key = typeof input.serviceAccountJson === "string" ? JSON.parse(input.serviceAccountJson) : input.serviceAccountJson; }
    catch (error) { throw new CloudProvisioningError(`Service account JSON is invalid: ${error.message}`, { status: 400 }); }
    if (!key || typeof key !== "object" || Array.isArray(key)) throw new CloudProvisioningError("Service account JSON must be an object", { status: 400 });
    return {
      projectId: required(key.project_id, "service account project_id"),
      clientEmail: required(key.client_email, "service account client_email"),
      privateKey: required(key.private_key, "service account private_key"),
      tokenUri: "https://oauth2.googleapis.com/token",
    };
  }
  providerDefinition(providerId);
}

function credentialAccount(providerId, credential) {
  if (providerId === "digitalocean" || providerId === "hetzner") return null;
  if (providerId === "aws") return credential.accessKeyId;
  return `${credential.clientEmail} · ${credential.projectId}`;
}

async function responseValue(response, providerName) {
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; }
  catch { throw new CloudProvisioningError(`${providerName} returned a non-JSON response (${response.status})`); }
  if (!response.ok) {
    const detail = value?.message || value?.error?.message || value?.error_description || value?.error || `${response.status} ${response.statusText}`;
    throw new CloudProvisioningError(`${providerName}: ${detail}`, { status: response.status === 401 || response.status === 403 ? response.status : 502 });
  }
  return value;
}

async function digitalOceanRequest(path, credential, fetchImpl, options = {}) {
  let response;
  try {
    response = await fetchImpl(`https://api.digitalocean.com/v2${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential.token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CloudProvisioningError(`DigitalOcean request failed: ${error.message}`, { cause: error });
  }
  return responseValue(response, "DigitalOcean");
}

async function digitalOceanOptions(credential, fetchImpl) {
  const [regionResult, sizeResult, imageResult] = await Promise.all([
    digitalOceanRequest("/regions?per_page=200", credential, fetchImpl),
    digitalOceanRequest("/sizes?per_page=200", credential, fetchImpl),
    digitalOceanRequest("/images?type=distribution&per_page=200", credential, fetchImpl),
  ]);
  const regions = (regionResult.regions || []).filter((item) => item.available).map((item) => ({ id: item.slug, name: item.name }));
  // DigitalOcean uses an empty regions array for sizes that are not currently
  // orderable anywhere (rather than meaning globally available).
  const sizes = (sizeResult.sizes || []).filter((item) => item.available && Array.isArray(item.regions) && item.regions.length).map((item) => ({
    id: item.slug,
    name: item.slug,
    description: `${item.vcpus} vCPU · ${Math.round(item.memory / 1024 * 10) / 10} GB RAM · $${item.price_monthly}/mo`,
    regions: item.regions || [],
  }));
  const images = (imageResult.images || []).filter((item) => item.status === "available" && item.slug && /ubuntu/i.test(`${item.distribution || ""} ${item.slug}`)).map((item) => ({
    id: item.slug,
    name: item.description || item.name || item.slug,
    description: item.distribution || "Distribution image",
    regions: item.regions || [],
  }));
  return { regions, sizes, images, defaults: { region: regions[0]?.id, size: sizes.find((item) => item.id === "s-1vcpu-1gb")?.id || sizes[0]?.id, image: images.find((item) => /ubuntu/i.test(item.id))?.id || images[0]?.id } };
}

const DIGITALOCEAN_OWNERSHIP_TAG = "oyster-hub";

async function ensureDigitalOceanOwnershipTag(credential, fetchImpl) {
  const value = await digitalOceanRequest("/tags?per_page=200", credential, fetchImpl);
  if ((value.tags || []).some((tag) => tag.name === DIGITALOCEAN_OWNERSHIP_TAG)) return;
  await digitalOceanRequest("/tags", credential, fetchImpl, {
    method: "POST",
    body: JSON.stringify({ name: DIGITALOCEAN_OWNERSHIP_TAG }),
  });
}

async function digitalOceanManage(record, action, credential, fetchImpl) {
  const instanceId = encodeURIComponent(required(record.provider?.instanceId, "DigitalOcean instance ID"));
  if (action === "destroy") {
    await digitalOceanRequest(`/droplets/${instanceId}`, credential, fetchImpl, { method: "DELETE" });
    return { state: "destroyed" };
  }
  const type = action === "pause" ? "power_off" : "power_on";
  const value = await digitalOceanRequest(`/droplets/${instanceId}/actions`, credential, fetchImpl, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  return { state: value.action?.status || (action === "pause" ? "paused" : "resuming") };
}

async function digitalOceanProvision(input, credential, fetchImpl) {
  // Use one stable ownership tag. Generation-specific tags would be new for
  // every VM and force DigitalOcean to exercise tag:create during every
  // Droplet request even when the Hub ownership tag already exists.
  await ensureDigitalOceanOwnershipTag(credential, fetchImpl);
  const value = await digitalOceanRequest("/droplets", credential, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      region: input.region,
      size: input.size,
      image: input.image,
      user_data: input.userData,
      tags: [DIGITALOCEAN_OWNERSHIP_TAG],
    }),
  });
  const instanceId = String(value.droplet?.id || "");
  return {
    instanceId,
    state: value.droplet?.status || "new",
    consoleUrl: instanceId ? `https://cloud.digitalocean.com/droplets/${encodeURIComponent(instanceId)}` : null,
  };
}

async function hetznerRequest(path, credential, fetchImpl, options = {}) {
  let response;
  try {
    response = await fetchImpl(`https://api.hetzner.cloud/v1${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential.token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new CloudProvisioningError(`Hetzner Cloud request failed: ${error.message}`, { cause: error });
  }
  return responseValue(response, "Hetzner Cloud");
}

function activeHetznerLocations(serverType) {
  if (Array.isArray(serverType.locations)) {
    const now = Date.now();
    return serverType.locations.filter((location) => {
      if (!location?.name || location.available === false) return false;
      const unavailableAt = Date.parse(location.deprecation?.unavailable_after || "");
      return !Number.isFinite(unavailableAt) || unavailableAt > now;
    }).map((location) => location.name);
  }
  // Compatibility with older responses that exposed availability only through
  // per-location prices.
  return (serverType.prices || []).map((entry) => entry.location).filter(Boolean);
}

async function hetznerOptions(credential, fetchImpl) {
  const [locationResult, typeResult, imageResult] = await Promise.all([
    hetznerRequest("/locations?per_page=100", credential, fetchImpl),
    hetznerRequest("/server_types?per_page=100", credential, fetchImpl),
    hetznerRequest("/images?type=system&sort=name&per_page=100", credential, fetchImpl),
  ]);
  const regions = (locationResult.locations || []).map((item) => ({
    id: item.name,
    name: `${item.description || item.city || item.name}${item.description || item.city ? ` (${item.name})` : ""}`,
  }));
  const knownRegions = new Set(regions.map((region) => region.id));
  const sizes = (typeResult.server_types || []).map((item) => ({
    id: item.name,
    name: item.name,
    description: `${item.cores} vCPU · ${item.memory} GB RAM · €${item.prices?.[0]?.price_monthly?.net || "?"}/mo`,
    regions: activeHetznerLocations(item).filter((region) => knownRegions.has(region)),
    architecture: item.architecture || null,
  })).filter((item) => item.id && item.regions.length);
  // Use image IDs rather than names because Hetzner can expose the same system
  // image name for multiple CPU architectures.
  const images = (imageResult.images || []).filter((item) => item.id && item.name && item.status !== "creating" && /ubuntu/i.test(`${item.description || ""} ${item.name}`)).map((item) => ({
    id: String(item.id),
    name: item.description || item.name,
    description: `${item.os_flavor || "Ubuntu"}${item.architecture ? ` · ${item.architecture}` : ""}`,
    architecture: item.architecture || null,
  }));
  const defaultSize = sizes.find((item) => item.id === "cx22") || sizes.find((item) => item.architecture === "x86") || sizes[0];
  const compatibleImages = images.filter((item) => !defaultSize?.architecture || !item.architecture || item.architecture === defaultSize.architecture);
  return {
    regions,
    sizes,
    images,
    defaults: {
      region: defaultSize?.regions.find((region) => knownRegions.has(region)) || regions[0]?.id,
      size: defaultSize?.id,
      image: compatibleImages.find((item) => /24\.04/i.test(item.name))?.id || compatibleImages[0]?.id,
    },
  };
}

const HETZNER_LABELS = Object.freeze({ "managed-by": "oyster-hub" });

async function hetznerManage(record, action, credential, fetchImpl) {
  const instanceId = encodeURIComponent(required(record.provider?.instanceId, "Hetzner Cloud instance ID"));
  if (action === "destroy") {
    await hetznerRequest(`/servers/${instanceId}`, credential, fetchImpl, { method: "DELETE" });
    return { state: "destroyed" };
  }
  // Pause requests a graceful ACPI shutdown. Hetzner explicitly documents
  // poweroff as equivalent to pulling the power cord and warns of data loss.
  const path = action === "pause" ? "shutdown" : "poweron";
  await hetznerRequest(`/servers/${instanceId}/actions/${path}`, credential, fetchImpl, { method: "POST" });
  return { state: action === "pause" ? "stopping" : "starting" };
}

async function hetznerProvision(input, credential, fetchImpl) {
  const value = await hetznerRequest("/servers", credential, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      server_type: input.size,
      image: input.image,
      location: input.region,
      user_data: input.userData,
      labels: {
        ...HETZNER_LABELS,
        "oyster-box-id": input.boxId,
        "oyster-generation": input.generation,
      },
    }),
  });
  const server = value.server || {};
  const instanceId = String(server.id || "");
  if (!instanceId) throw new CloudProvisioningError("Hetzner Cloud did not return a server ID");
  const ipv4 = server.public_net?.ipv4?.ip || null;
  return {
    instanceId,
    state: server.status || "starting",
    ipv4,
    // Hetzner console deep links require a project ID, which API tokens do not
    // expose. Link to the valid console root rather than inventing a broken URL.
    consoleUrl: "https://console.hetzner.cloud/",
  };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);
const awsEncode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

function awsTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function awsRequest(action, parameters, region, credential, fetchImpl) {
  const host = `ec2.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const timestamp = awsTimestamp();
  const date = timestamp.slice(0, 8);
  const values = { Action: action, Version: "2016-11-15", ...parameters };
  const body = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(String(value))}`).join("&");
  const headers = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    host,
    "x-amz-date": timestamp,
    ...(credential.sessionToken ? { "x-amz-security-token": credential.sessionToken } : {}),
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(body)].join("\n");
  const scope = `${date}/${region}/ec2/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${credential.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "ec2");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  let response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new CloudProvisioningError(`AWS request failed: ${error.message}`, { cause: error });
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = xmlFirst(text, "Message") || `${response.status} ${response.statusText}`;
    throw new CloudProvisioningError(`AWS: ${detail}`, { status: response.status === 401 || response.status === 403 ? 401 : 502 });
  }
  return text;
}

function decodeXml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlFirst(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function xmlItems(xml, containerTag = "item") {
  return [...String(xml).matchAll(new RegExp(`<${containerTag}>([\\s\\S]*?)<\\/${containerTag}>`, "gi"))].map((match) => match[1]);
}

async function awsOptions(credential, fetchImpl, requestedRegion) {
  const homeRegion = credential.defaultRegion || "us-east-1";
  const regionXml = await awsRequest("DescribeRegions", { AllRegions: "false" }, homeRegion, credential, fetchImpl);
  const regions = xmlItems(regionXml).map((item) => ({ id: xmlFirst(item, "regionName"), name: xmlFirst(item, "regionName") })).filter((item) => item.id);
  const region = regions.some((item) => item.id === requestedRegion) ? requestedRegion : (regions.some((item) => item.id === homeRegion) ? homeRegion : regions[0]?.id);
  if (!region) return { regions, sizes: [], images: [], defaults: {} };
  const [typeXml, imageXml] = await Promise.all([
    awsRequest("DescribeInstanceTypeOfferings", { LocationType: "region", "Filter.1.Name": "location", "Filter.1.Value.1": region, MaxResults: 1000 }, region, credential, fetchImpl),
    awsRequest("DescribeImages", {
      "Owners.1": "099720109477",
      "Filter.1.Name": "name", "Filter.1.Value.1": "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*",
      "Filter.2.Name": "state", "Filter.2.Value.1": "available",
      "Filter.3.Name": "root-device-type", "Filter.3.Value.1": "ebs",
      MaxResults: 100,
    }, region, credential, fetchImpl),
  ]);
  const sizes = [...new Set(xmlItems(typeXml).map((item) => xmlFirst(item, "instanceType")).filter(Boolean))].sort().map((id) => ({ id, name: id }));
  const images = xmlItems(imageXml).map((item) => ({
    id: xmlFirst(item, "imageId"),
    name: xmlFirst(item, "name") || xmlFirst(item, "imageId"),
    description: xmlFirst(item, "description"),
    createdAt: xmlFirst(item, "creationDate"),
  })).filter((item) => item.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { regions, sizes, images, defaults: { region, size: sizes.find((item) => item.id === "t3.micro")?.id || sizes[0]?.id, image: images[0]?.id } };
}

async function awsManage(record, action, credential, fetchImpl) {
  const region = required(record.provider?.region, "AWS region");
  const instanceId = required(record.provider?.instanceId, "AWS instance ID");
  const awsAction = action === "pause" ? "StopInstances" : action === "resume" ? "StartInstances" : "TerminateInstances";
  const xml = await awsRequest(awsAction, { "InstanceId.1": instanceId }, region, credential, fetchImpl);
  return { state: xmlFirst(xml, "name") || (action === "destroy" ? "terminated" : action === "pause" ? "stopping" : "pending") };
}

async function awsProvision(input, credential, fetchImpl) {
  const xml = await awsRequest("RunInstances", {
    ImageId: input.image,
    InstanceType: input.size,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(input.userData, "utf8").toString("base64"),
    "TagSpecification.1.ResourceType": "instance",
    "TagSpecification.1.Tag.1.Key": "Name",
    "TagSpecification.1.Tag.1.Value": input.name,
    "TagSpecification.1.Tag.2.Key": "oyster:managed-by",
    "TagSpecification.1.Tag.2.Value": "oyster-hub",
    "TagSpecification.1.Tag.3.Key": "oyster:box-id",
    "TagSpecification.1.Tag.3.Value": input.boxId,
    "TagSpecification.1.Tag.4.Key": "oyster:generation",
    "TagSpecification.1.Tag.4.Value": input.generation,
  }, input.region, credential, fetchImpl);
  const instanceId = xmlFirst(xml, "instanceId");
  if (!instanceId) throw new CloudProvisioningError("AWS did not return an instance ID");
  return { instanceId, state: xmlFirst(xml, "name") || "pending", consoleUrl: `https://${input.region}.console.aws.amazon.com/ec2/home?region=${encodeURIComponent(input.region)}#InstanceDetails:instanceId=${encodeURIComponent(instanceId)}` };
}

const base64url = (value) => Buffer.from(value).toString("base64url");

async function gcpAccessToken(credential, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: credential.clientEmail,
    scope: "https://www.googleapis.com/auth/compute",
    aud: credential.tokenUri,
    iat: now,
    exp: now + 3600,
  }))}`;
  let signature;
  try { signature = signValue("RSA-SHA256", Buffer.from(assertion), credential.privateKey).toString("base64url"); }
  catch (error) { throw new CloudProvisioningError(`GCP service account private key is invalid: ${error.message}`, { status: 400 }); }
  let response;
  try {
    response = await fetchImpl(credential.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${assertion}.${signature}` }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) { throw new CloudProvisioningError(`GCP OAuth request failed: ${error.message}`, { cause: error }); }
  const value = await responseValue(response, "GCP OAuth");
  return required(value.access_token, "GCP OAuth access token");
}

async function gcpRequest(path, credential, fetchImpl, options = {}) {
  const token = await gcpAccessToken(credential, fetchImpl);
  let response;
  try {
    response = await fetchImpl(`https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(credential.projectId)}${path}`, {
      ...options,
      headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) { throw new CloudProvisioningError(`GCP request failed: ${error.message}`, { cause: error }); }
  return responseValue(response, "GCP");
}

async function gcpOptions(credential, fetchImpl, requestedZone) {
  const [zoneResult, imageResult] = await Promise.all([
    gcpRequest("/zones?maxResults=500", credential, fetchImpl),
    (async () => {
      const token = await gcpAccessToken(credential, fetchImpl);
      const response = await fetchImpl("https://compute.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images?maxResults=100&orderBy=creationTimestamp%20desc&filter=status%3DREADY%20AND%20family%3Dubuntu-2404-lts-amd64", {
        headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
      });
      return responseValue(response, "GCP");
    })(),
  ]);
  const regions = (zoneResult.items || []).filter((item) => item.status === "UP").map((item) => ({ id: item.name, name: `${item.name} · ${item.description || "available zone"}` }));
  const region = regions.some((item) => item.id === requestedZone) ? requestedZone : regions[0]?.id;
  const typeResult = region ? await gcpRequest(`/zones/${encodeURIComponent(region)}/machineTypes?maxResults=500`, credential, fetchImpl) : { items: [] };
  const sizes = (typeResult.items || []).map((item) => ({ id: item.name, name: item.name, description: `${item.guestCpus} vCPU · ${Math.round(item.memoryMb / 1024 * 10) / 10} GB RAM` }));
  const images = (imageResult.items || []).map((item) => ({ id: item.name, name: item.name, description: item.description || "Ubuntu image" }));
  return { regions, sizes, images, defaults: { region, size: sizes.find((item) => item.id === "e2-micro")?.id || sizes[0]?.id, image: images[0]?.id } };
}

async function gcpManage(record, action, credential, fetchImpl) {
  const zone = encodeURIComponent(required(record.provider?.region, "GCP zone"));
  const instanceName = encodeURIComponent(required(record.boxId || record.name, "GCP instance name"));
  const suffix = action === "destroy" ? "" : `/${action === "pause" ? "stop" : "start"}`;
  const value = await gcpRequest(`/zones/${zone}/instances/${instanceName}${suffix}`, credential, fetchImpl, {
    method: action === "destroy" ? "DELETE" : "POST",
  });
  return { state: value.status || (action === "destroy" ? "destroyed" : action === "pause" ? "stopping" : "pending") };
}

async function gcpProvision(input, credential, fetchImpl) {
  const image = `projects/ubuntu-os-cloud/global/images/${input.image}`;
  const value = await gcpRequest(`/zones/${encodeURIComponent(input.region)}/instances`, credential, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      machineType: `zones/${input.region}/machineTypes/${input.size}`,
      disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: image } }],
      networkInterfaces: [{ network: "global/networks/default", accessConfigs: [{ name: "External NAT", type: "ONE_TO_ONE_NAT" }] }],
      labels: {
        managed_by: "oyster-hub",
        oyster_box: input.boxId.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 63),
        generation: input.generation.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 63),
      },
      metadata: { items: [{ key: "user-data", value: input.userData }] },
    }),
  });
  return { instanceId: String(value.targetId || input.name), state: value.status || "PENDING", consoleUrl: `https://console.cloud.google.com/compute/instancesDetail/zones/${encodeURIComponent(input.region)}/instances/${encodeURIComponent(input.name)}?project=${encodeURIComponent(credential.projectId)}` };
}

function publicProvider(provider) {
  if (provider?.id === "digitalocean" && provider.instanceId) {
    return { ...provider, consoleUrl: `https://cloud.digitalocean.com/droplets/${encodeURIComponent(provider.instanceId)}` };
  }
  if (provider?.id === "hetzner" && provider.instanceId) {
    return { ...provider, consoleUrl: "https://console.hetzner.cloud/" };
  }
  return { ...provider };
}

function lifecycleStatus(record, registration = null) {
  if (["paused", "pausing", "resuming", "destroying"].includes(record.status)) return record.status;
  return registration?.status || record.status;
}

function publicEnvironment(record, registration = null) {
  const status = lifecycleStatus(record, registration);
  return {
    id: record.id,
    name: record.name,
    status,
    local: false,
    cloud: true,
    createdAt: record.createdAt,
    provider: {
      ...publicProvider(record.provider),
      generation: record.generation,
      registrationStatus: status,
      lastSeenAt: registration?.lastSeenAt || null,
    },
  };
}

function publicCloudWorkspace(record, registration = null, fetchImpl = null) {
  const status = lifecycleStatus(record, registration);
  return {
    environmentId: record.id,
    environmentName: record.name,
    id: record.id,
    name: record.name,
    url: "http://127.0.0.1:8080",
    status,
    ...(fetchImpl ? { fetchImpl } : {}),
    provider: {
      ...publicProvider(record.provider),
      type: "cloud",
      boxId: record.boxId,
      generation: record.generation,
      phase: status,
      directAgent: true,
      lastSeenAt: registration?.lastSeenAt || null,
      observed: registration?.observed || null,
    },
  };
}

function environmentId(providerId, instanceId) {
  const clean = String(instanceId || randomUUID()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52);
  return `${providerId}-${clean || randomUUID().slice(0, 8)}`;
}

export function createCloudProvisioningService({
  stateFile = null,
  fetchImpl = globalThis.fetch,
  boxRegistry = createBoxConnectionRegistry(),
  boxConnectUrl = oysterCloudInitDefaults.boxConnectUrl,
  repository = oysterCloudInitDefaults.repository,
  ref = oysterCloudInitDefaults.ref,
} = {}) {
  let loaded = false;
  let state = { credentials: {}, environments: [] };
  let writeChain = Promise.resolve();

  async function load() {
    if (loaded) return;
    if (!stateFile) {
      loaded = true;
      return;
    }
    try {
      const parsed = JSON.parse(await readFile(stateFile, "utf8"));
      state = {
        credentials: parsed?.credentials && typeof parsed.credentials === "object" ? parsed.credentials : {},
        environments: Array.isArray(parsed?.environments) ? parsed.environments : [],
      };
      loaded = true;
    } catch (error) {
      if (error.code === "ENOENT") loaded = true;
      else throw new CloudProvisioningError(`cannot read cloud state: ${error.message}`, { status: 500, cause: error });
    }
  }

  async function persist() {
    if (!stateFile) return;
    const snapshot = JSON.stringify(state, null, 2);
    writeChain = writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${snapshot}\n`, { mode: 0o600 });
      await rename(temporary, stateFile);
      await chmod(stateFile, 0o600);
    });
    return writeChain;
  }

  async function credential(providerId) {
    await load();
    providerDefinition(providerId);
    const value = state.credentials[providerId];
    if (!value) throw new CloudProvisioningError(`${PROVIDERS[providerId].name} credentials are not configured`, { status: 409 });
    return value;
  }

  async function recordFor(id) {
    await load();
    const record = state.environments.find((item) => item.id === id);
    if (!record) throw new CloudProvisioningError("cloud environment not found", { status: 404 });
    return record;
  }

  async function registrationFor(record) {
    const registration = record.generation
      ? await boxRegistry.get(record.boxId || record.name.toLowerCase(), record.generation)
      : null;
    if (record.status === "resuming" && registration?.status === "online") {
      record.status = "active";
      record.provider = { ...record.provider, state: "running" };
      await persist();
    }
    return registration;
  }

  async function providerAction(record, action) {
    const providerId = record.provider?.id;
    const value = await credential(providerId);
    if (providerId === "digitalocean") return digitalOceanManage(record, action, value, fetchImpl);
    if (providerId === "hetzner") return hetznerManage(record, action, value, fetchImpl);
    if (providerId === "aws") return awsManage(record, action, value, fetchImpl);
    if (providerId === "gcp") return gcpManage(record, action, value, fetchImpl);
    throw new CloudProvisioningError(`unsupported cloud provider: ${providerId}`, { status: 404 });
  }

  return Object.freeze({
    async listProviders() {
      await load();
      return Object.values(PROVIDERS).map((provider) => ({
        ...provider,
        configured: Boolean(state.credentials[provider.id]),
        account: state.credentials[provider.id] ? credentialAccount(provider.id, state.credentials[provider.id]) : null,
      }));
    },
    async configure(providerId, input) {
      const provider = providerDefinition(providerId);
      await load();
      const value = normalizeCredentials(providerId, input);
      state.credentials = { ...state.credentials, [providerId]: value };
      await persist();
      return { provider: provider.id, configured: true, account: credentialAccount(providerId, value) };
    },
    async removeCredentials(providerId) {
      providerDefinition(providerId);
      await load();
      const next = { ...state.credentials };
      delete next[providerId];
      state.credentials = next;
      await persist();
      return { provider: providerId, configured: false };
    },
    async options(providerId, { region = "" } = {}) {
      const value = await credential(providerId);
      if (providerId === "digitalocean") return digitalOceanOptions(value, fetchImpl);
      if (providerId === "hetzner") return hetznerOptions(value, fetchImpl);
      if (providerId === "aws") return awsOptions(value, fetchImpl, region);
      return gcpOptions(value, fetchImpl, region);
    },
    async provision(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new CloudProvisioningError("environment request must be an object", { status: 400 });
      const providerId = required(input.provider, "provider");
      const provider = providerDefinition(providerId);
      const name = required(input.name, "Environment name");
      if (!/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)) throw new CloudProvisioningError("Environment name must be a 1-63 character DNS-style name", { status: 400 });
      const request = { name: name.toLowerCase(), region: required(input.region, "region"), size: required(input.size, "instance type"), image: required(input.image, "image") };
      const value = await credential(providerId);
      const registration = await boxRegistry.prepareRegistration({ boxId: request.name, provider: providerId });
      request.boxId = registration.boxId;
      request.generation = registration.generation;
      request.userData = createOysterCloudInit({
        boxId: registration.boxId,
        generation: registration.generation,
        bootstrapSecret: registration.bootstrapSecret,
        provider: providerId,
        boxConnectUrl,
        repository,
        ref,
      });
      let result;
      try {
        if (providerId === "digitalocean") result = await digitalOceanProvision(request, value, fetchImpl);
        else if (providerId === "hetzner") result = await hetznerProvision(request, value, fetchImpl);
        else if (providerId === "aws") result = await awsProvision(request, value, fetchImpl);
        else result = await gcpProvision(request, value, fetchImpl);
        await boxRegistry.bindProviderInstance(registration.boxId, registration.generation, result.instanceId);
      } catch (error) {
        await boxRegistry.revoke(registration.boxId, registration.generation, "provider provisioning failed").catch(() => {});
        throw error;
      }
      const record = {
        id: environmentId(providerId, result.instanceId),
        name,
        boxId: registration.boxId,
        generation: registration.generation,
        status: "awaiting_agent",
        createdAt: new Date().toISOString(),
        provider: {
          id: provider.id,
          name: provider.name,
          instanceId: result.instanceId,
          state: result.state,
          region: request.region,
          size: request.size,
          image: request.image,
          ...(result.consoleUrl ? { consoleUrl: result.consoleUrl } : {}),
        },
      };
      await load();
      state.environments = [...state.environments.filter((item) => item.id !== record.id), record];
      await persist();
      return publicEnvironment(record, await boxRegistry.get(request.name, registration.generation));
    },
    async listEnvironments() {
      await load();
      return Promise.all(state.environments.map(async (record) => publicEnvironment(record, await registrationFor(record))));
    },
    async listWorkspaces() {
      await load();
      return Promise.all(state.environments.map(async (record) => publicCloudWorkspace(
        record,
        await registrationFor(record),
        record.generation
          ? (target, options) => boxRegistry.fetch(record.boxId || record.name.toLowerCase(), record.generation, target, options)
          : null,
      )));
    },
    async getWorkspace(id) {
      return (await this.listWorkspaces()).find((workspace) => workspace.id === id) || null;
    },
    async pause(id) {
      const record = await recordFor(id);
      if (record.status === "paused") return publicEnvironment(record, await registrationFor(record));
      const result = await providerAction(record, "pause");
      record.status = "paused";
      record.provider = { ...record.provider, state: result.state || "paused" };
      record.pausedAt = new Date().toISOString();
      await persist();
      return publicEnvironment(record, await registrationFor(record));
    },
    async resume(id) {
      const record = await recordFor(id);
      if (record.status !== "paused") throw new CloudProvisioningError("cloud environment is not paused", { status: 409 });
      const result = await providerAction(record, "resume");
      record.status = "resuming";
      record.provider = { ...record.provider, state: result.state || "pending" };
      record.resumedAt = new Date().toISOString();
      await persist();
      return publicEnvironment(record, await registrationFor(record));
    },
    async destroy(id) {
      const record = await recordFor(id);
      await providerAction(record, "destroy");
      await boxRegistry.revoke(record.boxId || record.name.toLowerCase(), record.generation, "cloud environment destroyed").catch(() => {});
      state.environments = state.environments.filter((item) => item.id !== id);
      await persist();
      return { id, name: record.name, destroyed: true };
    },
  });
}
