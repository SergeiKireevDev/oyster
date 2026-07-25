<script>
  import { onDestroy, onMount } from "svelte";
  import { closeModalState } from "../stores/modal.js";
  import { publishCloudEnvironment } from "../stores/cloudEnvironments.js";

  let providers = [];
  let selectedProvider = null;
  let step = "providers";
  let loading = true;
  let error = "";
  let credentialValues = {};
  let options = { regions: [], sizes: [], images: [], defaults: {} };
  let environmentName = "";
  let region = "";
  let size = "";
  let image = "";
  let createdEnvironment = null;
  let destroyed = false;

  async function request(path, init) {
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function loadProviders() {
    loading = true;
    error = "";
    try {
      const data = await request("/api/v1/cloud/providers");
      if (!destroyed) providers = data.providers || [];
    } catch (cause) {
      if (!destroyed) error = cause.message;
    } finally {
      if (!destroyed) loading = false;
    }
  }

  function providerIcon(providerId) {
    return providerId === "digitalocean" ? "DO" : providerId === "hetzner" ? "HZ" : providerId === "aws" ? "AWS" : "G";
  }

  function chooseProvider(provider) {
    selectedProvider = provider;
    credentialValues = {};
    error = "";
    if (provider.configured) loadOptions();
    else step = "credentials";
  }

  function configureCredentials() {
    credentialValues = {};
    error = "";
    step = "credentials";
  }

  async function saveCredentials(event) {
    event.preventDefault();
    loading = true;
    error = "";
    try {
      await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentialValues),
      });
      providers = providers.map((provider) => provider.id === selectedProvider.id ? { ...provider, configured: true } : provider);
      selectedProvider = providers.find((provider) => provider.id === selectedProvider.id);
      credentialValues = {};
      await loadOptions();
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  async function loadOptions(requestedRegion = "") {
    step = "instance";
    loading = true;
    error = "";
    try {
      const query = requestedRegion ? `?region=${encodeURIComponent(requestedRegion)}` : "";
      const data = await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/options${query}`);
      options = { regions: data.regions || [], sizes: data.sizes || [], images: data.images || [], defaults: data.defaults || {} };
      region = data.defaults?.region || requestedRegion || options.regions[0]?.id || "";
      const regionSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, region));
      size = regionSizes.some((item) => item.id === data.defaults?.size) ? data.defaults.size : regionSizes[0]?.id || "";
      const regionImages = options.images.filter((item) => imageAvailableForSelection(item, region, size));
      image = regionImages.some((item) => item.id === data.defaults?.image) ? data.defaults.image : regionImages[0]?.id || "";
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  async function changeRegion(value) {
    region = value;
    if (["digitalocean", "hetzner"].includes(selectedProvider.id)) {
      const nextSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, value));
      if (!nextSizes.some((item) => item.id === size)) size = nextSizes[0]?.id || "";
      const nextImages = options.images.filter((item) => imageAvailableForSelection(item, value, size));
      if (!nextImages.some((item) => item.id === image)) image = nextImages[0]?.id || "";
      return;
    }
    await loadOptions(value);
  }

  function changeSize(value) {
    size = value;
    const nextImages = options.images.filter((item) => imageAvailableForSelection(item, region, value));
    if (!nextImages.some((item) => item.id === image)) image = nextImages[0]?.id || "";
  }

  function sizeAvailableInRegion(item, regionId) {
    return selectedProvider?.id === "digitalocean"
      ? Boolean(item?.regions?.includes(regionId))
      : (!item?.regions?.length || item.regions.includes(regionId));
  }

  function imageAvailableForSelection(item, regionId, sizeId) {
    if (item?.regions?.length && !item.regions.includes(regionId)) return false;
    const selected = options.sizes.find((candidate) => candidate.id === sizeId);
    return !selected?.architecture || !item?.architecture || selected.architecture === item.architecture;
  }

  function regionAvailability(item) {
    if (!item?.regions?.length) return selectedProvider?.id === "digitalocean" ? "no currently available regions reported by DigitalOcean" : "all listed regions";
    return item.regions.map((id) => {
      const regionOption = options.regions.find((candidate) => candidate.id === id);
      return regionOption?.name && regionOption.name !== id ? `${regionOption.name} (${id})` : id;
    }).join(", ");
  }

  function provisioningError(cause) {
    const message = cause?.message || "Provisioning failed";
    if (selectedProvider?.id !== "digitalocean" || !/size is not available in this region/i.test(message)) return message;
    const selectedSize = options.sizes.find((item) => item.id === size);
    return selectedSize ? `${message} ${selectedSize.name || selectedSize.id} is listed as available in: ${regionAvailability(selectedSize)}.` : message;
  }

  async function provision(event) {
    event.preventDefault();
    loading = true;
    error = "";
    try {
      const data = await request("/api/v1/environments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider.id, name: environmentName, region, size, image }),
      });
      createdEnvironment = data.environment;
      step = "done";
      publishCloudEnvironment(data.environment);
    } catch (cause) {
      error = provisioningError(cause);
    } finally {
      loading = false;
    }
  }

  function updateCredential(fieldId, value) {
    credentialValues = { ...credentialValues, [fieldId]: value };
  }

  $: availableSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, region));
  $: selectedSize = options.sizes.find((item) => item.id === size);
  $: selectedSizeAvailability = selectedProvider?.id === "digitalocean" && selectedSize ? regionAvailability(selectedSize) : "";
  $: availableImages = options.images.filter((item) => imageAvailableForSelection(item, region, size));
  $: credentialsComplete = selectedProvider?.fields.every((field) => !field.required || String(credentialValues[field.id] || "").trim());

  onMount(loadProviders);
  onDestroy(() => {
    destroyed = true;
    credentialValues = {};
  });
</script>

<section class="cloud-environment-modal" aria-label="Cloud environment provisioning">
  <nav class="cloud-steps" aria-label="Provisioning steps">
    <span class:active={step === "providers"} class:complete={step !== "providers"}>1 <b>Provider</b></span>
    <i></i>
    <span class:active={step === "credentials"} class:complete={["instance", "done"].includes(step)}>2 <b>Connect</b></span>
    <i></i>
    <span class:active={step === "instance"} class:complete={step === "done"}>3 <b>Instance</b></span>
  </nav>

  {#if step === "providers"}
    <p class="cloud-intro">Choose where to create the new environment. Hub provisions an Ubuntu VM, installs Oyster from source with cloud-init, and registers it over outbound WSS. Provider credentials remain on Hub.</p>
    {#if loading}<p class="cloud-state" role="status">Loading cloud providers…</p>{/if}
    <div class="cloud-provider-grid">
      {#each providers as provider (provider.id)}
        <button class="cloud-provider-card" type="button" onclick={() => chooseProvider(provider)} disabled={loading}>
          <span class={`cloud-provider-icon ${provider.id}`}>{providerIcon(provider.id)}</span>
          <span class="cloud-provider-copy">
            <strong>{provider.name}</strong>
            <small>{provider.description}</small>
          </span>
          <span class:configured={provider.configured} class="cloud-provider-status">{provider.configured ? "Connected" : "Connect"}</span>
        </button>
      {/each}
    </div>
  {:else if step === "credentials"}
    <header class="cloud-section-head">
      <button type="button" class="cloud-back" onclick={() => { step = "providers"; error = ""; }}>←</button>
      <div><small>Cloud provider</small><h3>{selectedProvider.name}</h3></div>
    </header>
    <div class="cloud-auth-note">
      <strong>{selectedProvider.authType === "oauth_service_account" ? "OAuth 2.0 service account" : selectedProvider.authType === "access_key" ? "IAM access key" : "API token"}</strong>
      <span>{selectedProvider.oauthSupported ? "OAuth is handled server-to-server with the supplied service account." : "Interactive OAuth is not available for this provider in the initial flow."}</span>
    </div>
    <form class="cloud-form" onsubmit={saveCredentials}>
      {#each selectedProvider.fields as field (field.id)}
        <label class:wide={field.type === "textarea"}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {#if field.type === "textarea"}
            <textarea rows="8" value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} autocomplete="off" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)}></textarea>
          {:else}
            <input type={field.type} value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} required={field.required} autocomplete="off" autocapitalize="none" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)} />
          {/if}
        </label>
      {/each}
      {#if selectedProvider.id === "digitalocean"}
        <p class="cloud-secret-note"><strong>Required token permissions:</strong> <code>droplet:create</code>, <code>tag:read</code>, <code>tag:create</code>, <code>region:read</code>, <code>size:read</code>, and <code>image:read</code>. <code>tag:create</code> is required at least once to create the <code>oyster-hub</code> ownership tag.</p>
      {/if}
      <p class="cloud-secret-note">Credentials are written with owner-only permissions when the Hub has a cloud state file configured.</p>
      <button class="btn cloud-primary" type="submit" disabled={loading || !credentialsComplete}>{loading ? "Connecting…" : `Connect ${selectedProvider.name}`}</button>
    </form>
  {:else if step === "instance"}
    <header class="cloud-section-head">
      <button type="button" class="cloud-back" onclick={() => { step = "providers"; error = ""; }}>←</button>
      <div><small>Provision with</small><h3>{selectedProvider.name}</h3></div>
      <button class="cloud-manage-credentials" type="button" onclick={configureCredentials}>Replace credentials</button>
    </header>
    {#if loading}
      <div class="cloud-loading" role="status"><span></span><strong>Querying available instances…</strong><small>This may take a few seconds.</small></div>
    {:else if options.regions.length}
      <form class="cloud-form instance" onsubmit={provision}>
        <label class="wide">
          <span>Environment name *</span>
          <input type="text" bind:value={environmentName} pattern="[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?" maxlength="63" placeholder="dev-cloud-1" title="Use 1–63 letters, numbers, or hyphens; start and end with a letter or number" required />
          <small>Cloud-init installs Oyster from source and registers this VM with Hub at wss://hub.get-oyster.dev/box/connect.</small>
        </label>
        <label>
          <span>{selectedProvider.id === "gcp" ? "Zone" : "Region"} *</span>
          <select value={region} onchange={(event) => changeRegion(event.currentTarget.value)} disabled={loading} required>
            {#each options.regions as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
          </select>
        </label>
        <label>
          <span>Instance type *</span>
          <select value={size} onchange={(event) => changeSize(event.currentTarget.value)} required>
            {#each availableSizes as item (item.id)}<option value={item.id}>{item.name}{item.description ? ` — ${item.description}` : ""}</option>{/each}
          </select>
          {#if selectedSizeAvailability}<small>Available in: {selectedSizeAvailability}</small>{/if}
        </label>
        <label class="wide">
          <span>Image *</span>
          <select bind:value={image} required>
            {#each availableImages as item (item.id)}<option value={item.id}>{item.name}{item.description ? ` — ${item.description}` : ""}</option>{/each}
          </select>
        </label>
        <div class="cloud-summary wide">
          <span><small>Provider</small><strong>{selectedProvider.name}</strong></span>
          <span><small>Location</small><strong>{region}</strong></span>
          <span><small>Type</small><strong>{size}</strong></span>
        </div>
        <p class="cloud-required-hint wide">All fields are required. If anything is missing, selecting Provision will highlight it.</p>
        <button class="btn cloud-primary wide" type="submit" disabled={loading}>{loading ? "Provisioning…" : "Provision Oyster environment"}</button>
      </form>
    {:else if !error}
      <p class="cloud-state">No available regions or zones were returned by this provider.</p>
    {/if}
  {:else if step === "done"}
    <div class="cloud-success">
      <span class="cloud-success-icon">✓</span>
      <small>Provisioning started</small>
      <h3>{createdEnvironment.name}</h3>
      <p>The VM was created with Oyster cloud-init. It appears immediately as awaiting agent while the source build runs, then registers itself with Hub and becomes online.</p>
      <dl>
        <div><dt>Provider</dt><dd>{createdEnvironment.provider.name}</dd></div>
        <div><dt>Instance</dt><dd>{createdEnvironment.provider.instanceId}</dd></div>
        <div><dt>Location</dt><dd>{createdEnvironment.provider.region}</dd></div>
        <div><dt>Type</dt><dd>{createdEnvironment.provider.size}</dd></div>
      </dl>
      {#if createdEnvironment.provider.consoleUrl}<a class="btn cloud-console-link" href={createdEnvironment.provider.consoleUrl} target="_blank" rel="noopener noreferrer">Open provider console ↗</a>{/if}
    </div>
  {/if}

  {#if error}<p class="cloud-error" role="alert">{error}</p>{/if}
</section>

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={closeModalState}>{step === "done" ? "Done" : "Cancel"}</button>
</div>
