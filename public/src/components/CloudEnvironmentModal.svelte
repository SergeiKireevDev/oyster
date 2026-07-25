<script>
  import { onDestroy, onMount } from "svelte";
  import { closeModalState } from "../stores/modal.js";
  import { publishCloudEnvironment } from "../stores/cloudEnvironments.js";
  import { cloudBrowser } from "../features/cloud/cloudBrowser.js";

  let providers = [];
  let selectedProvider = null;
  let step = "providers";
  let loading = true;
  let error = "";
  let credentialValues = {};
  let selectedMethodId = "";
  let advancedMethods = false;
  let authorizationFlow = null;
  let awsAccountId = "";
  let awsRoleFlow = null;
  let handoffFlow = null;
  let handoffId = "";
  let handoffTimer = null;
  let awsRoleTimer = null;
  let releaseBrowserResume = () => {};
  let projects = [];
  let projectId = "";
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

  function methodsFor(provider) {
    return (provider?.authMethods || []).filter((method) => method.available !== false);
  }

  function primaryMethod(provider) {
    return methodsFor(provider).find((method) => method.primary) || methodsFor(provider)[0] || null;
  }

  function chooseMethod(methodId) {
    selectedMethodId = methodId;
    credentialValues = {};
    error = "";
  }

  function providerIcon(providerId) {
    return providerId === "digitalocean" ? "DO" : providerId === "hetzner" ? "HZ" : providerId === "aws" ? "AWS" : "G";
  }

  function chooseProvider(provider) {
    selectedProvider = provider;
    credentialValues = {};
    advancedMethods = false;
    selectedMethodId = primaryMethod(provider)?.id || "";
    error = "";
    if (provider.configured && provider.requiresProject) loadProjects();
    else if (provider.configured) loadOptions();
    else step = "credentials";
  }

  async function disconnectProvider() {
    const upstream = selectedProvider.id === "gcp"
      ? "Oyster will also request Google token revocation."
      : "This removes Hub's credential but may not revoke it at the provider.";
    if (!confirm(`Disconnect ${selectedProvider.name}?\n\n${upstream}`)) return;
    loading = true;
    error = "";
    try {
      await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/credentials`, { method: "DELETE" });
      await loadProviders();
      selectedProvider = null;
      step = "providers";
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  function configureCredentials() {
    credentialValues = {};
    advancedMethods = false;
    selectedMethodId = primaryMethod(selectedProvider)?.id || "";
    error = "";
    step = "credentials";
  }

  async function startAuthorization() {
    loading = true;
    error = "";
    try {
      const data = await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/authorization/start`, { method: "POST" });
      authorizationFlow = data.flow;
      cloudBrowser.navigate(data.flow.authorizationUrl);
    } catch (cause) {
      error = cause.message;
      loading = false;
    }
  }

  async function startAwsRole() {
    loading = true;
    error = "";
    try {
      const data = await request("/api/v1/cloud/providers/aws/role/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: awsAccountId }),
      });
      awsRoleFlow = data.flow;
      clearInterval(awsRoleTimer);
      awsRoleTimer = setInterval(() => { if (!cloudBrowser.hidden()) verifyAwsRole({ quiet: true }); }, 4_000);
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  async function verifyAwsRole({ quiet = false } = {}) {
    if (!awsRoleFlow || loading || cloudBrowser.hidden()) return;
    if (!quiet) loading = true;
    if (!quiet) error = "";
    try {
      const data = await request(`/api/v1/cloud/authorization/aws/${encodeURIComponent(awsRoleFlow.id)}/verify`, { method: "POST" });
      awsRoleFlow = data.flow;
      if (data.flow.status === "succeeded") {
        clearInterval(awsRoleTimer);
        await loadProviders();
        selectedProvider = providers.find((provider) => provider.id === "aws");
        await loadOptions();
      } else if (!quiet) error = data.flow.error || "The AWS role is not ready yet.";
    } catch (cause) {
      if (!quiet) error = cause.message;
    } finally {
      if (!quiet) loading = false;
    }
  }

  async function restoreAuthorization(flowId) {
    try {
      const data = await request(`/api/v1/cloud/authorization/${encodeURIComponent(flowId)}/status`);
      authorizationFlow = data.flow;
      selectedProvider = providers.find((provider) => provider.id === data.flow.provider) || null;
      if (!selectedProvider) throw new Error("Connected cloud provider is unavailable");
      selectedMethodId = "oauth_redirect";
      cloudBrowser.removeQuery("cloud-connect");
      if (data.flow.status !== "succeeded") {
        step = "credentials";
        throw new Error(data.flow.error || "Cloud sign-in did not complete");
      }
      await loadProviders();
      selectedProvider = providers.find((provider) => provider.id === data.flow.provider) || selectedProvider;
      if (data.flow.requiresProject || selectedProvider.requiresProject) await loadProjects();
      else await loadOptions();
    } catch (cause) {
      error = cause.message;
      loading = false;
    }
  }

  async function loadProjects() {
    step = "project";
    loading = true;
    error = "";
    try {
      const data = await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/projects`);
      projects = data.projects || [];
      projectId = projects[0]?.id || "";
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  async function selectProject(event) {
    event.preventDefault();
    loading = true;
    error = "";
    try {
      await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      await loadOptions();
    } catch (cause) {
      error = cause.message;
      loading = false;
    }
  }

  async function startHandoff() {
    loading = true;
    error = "";
    try {
      const data = await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/handoff/start`, { method: "POST" });
      handoffFlow = { ...data.flow, url: cloudBrowser.handoffUrl(data.flow.id) };
      clearInterval(handoffTimer);
      handoffTimer = setInterval(checkHandoff, 2_000);
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }

  async function checkHandoff() {
    if (!handoffFlow || destroyed || cloudBrowser.hidden()) return;
    try {
      const data = await request(`/api/v1/cloud/handoff/${encodeURIComponent(handoffFlow.id)}/status`);
      handoffFlow = { ...handoffFlow, ...data.flow };
      if (data.flow.status === "succeeded") {
        clearInterval(handoffTimer);
        await loadProviders();
        selectedProvider = providers.find((provider) => provider.id === data.flow.provider);
        if (selectedProvider?.requiresProject) await loadProjects();
        else if (selectedProvider) await loadOptions();
      }
    } catch (cause) {
      clearInterval(handoffTimer);
      error = cause.message;
    }
  }

  async function copyHandoffUrl() {
    try { await cloudBrowser.copyText(handoffFlow.url); }
    catch { error = "Copy failed. Select and copy the link manually."; }
  }

  async function cancelHandoff() {
    const id = handoffFlow?.id || handoffId;
    if (!id) return;
    try { await request(`/api/v1/cloud/handoff/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
    catch {}
    clearInterval(handoffTimer);
    handoffFlow = null;
    if (handoffId) {
      handoffId = "";
      credentialValues = {};
      step = "providers";
    }
  }

  async function saveCredentials(event) {
    event.preventDefault();
    loading = true;
    error = "";
    try {
      await request(`/api/v1/cloud/providers/${encodeURIComponent(selectedProvider.id)}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...credentialValues, ...(handoffId ? { handoffId } : {}) }),
      });
      providers = providers.map((provider) => provider.id === selectedProvider.id ? { ...provider, configured: true } : provider);
      selectedProvider = providers.find((provider) => provider.id === selectedProvider.id);
      credentialValues = {};
      if (selectedProvider.id === "gcp" && selectedMethodId === "oauth_redirect") await loadProjects();
      else await loadOptions();
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

  async function updateCredentialFile(fieldId, file) {
    if (!file) return updateCredential(fieldId, "");
    if (file.size > 64 * 1024) {
      error = "Credential file is too large";
      return;
    }
    updateCredential(fieldId, await file.text());
  }

  function resumeExternalSetup() {
    if (cloudBrowser.hidden()) return;
    if (handoffFlow) checkHandoff();
    if (awsRoleFlow) verifyAwsRole({ quiet: true });
  }

  async function initialize() {
    releaseBrowserResume = cloudBrowser.onResume(resumeExternalSetup);
    await loadProviders();
    const flowId = cloudBrowser.query("cloud-connect");
    if (flowId && !destroyed) await restoreAuthorization(flowId);
    const deviceFlowId = cloudBrowser.query("cloud-handoff");
    if (deviceFlowId && !destroyed) {
      try {
        const data = await request(`/api/v1/cloud/handoff/${encodeURIComponent(deviceFlowId)}/status`);
        handoffId = deviceFlowId;
        cloudBrowser.removeQuery("cloud-handoff");
        selectedProvider = providers.find((provider) => provider.id === data.flow.provider);
        selectedMethodId = methodsFor(selectedProvider).find((method) => ["api_token", "access_key", "service_account_file"].includes(method.id))?.id || primaryMethod(selectedProvider)?.id || "";
        advancedMethods = true;
        step = "credentials";
      } catch (cause) { error = cause.message; }
    }
  }

  $: selectedMethod = methodsFor(selectedProvider).find((method) => method.id === selectedMethodId) || primaryMethod(selectedProvider);
  $: credentialFields = selectedMethod?.fields || [];
  $: googleComputeConsoleUrl = projectId ? `https://console.cloud.google.com/apis/library/compute.googleapis.com?project=${encodeURIComponent(projectId)}` : "https://console.cloud.google.com/apis/library/compute.googleapis.com";
  $: availableSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, region));
  $: selectedSize = options.sizes.find((item) => item.id === size);
  $: selectedSizeAvailability = selectedProvider?.id === "digitalocean" && selectedSize ? regionAvailability(selectedSize) : "";
  $: availableImages = options.images.filter((item) => imageAvailableForSelection(item, region, size));
  $: credentialsComplete = credentialFields.every((field) => !field.required || String(credentialValues[field.id] || "").trim());

  onMount(initialize);
  onDestroy(() => {
    destroyed = true;
    clearInterval(handoffTimer);
    clearInterval(awsRoleTimer);
    releaseBrowserResume();
    credentialValues = {};
  });
</script>

<section class="cloud-environment-modal" aria-label="Cloud environment provisioning">
  <nav class="cloud-steps" aria-label="Provisioning steps">
    <span class:active={step === "providers"} class:complete={step !== "providers"}>1 <b>Provider</b></span>
    <i></i>
    <span class:active={["credentials", "project"].includes(step)} class:complete={["instance", "done"].includes(step)}>2 <b>Connect</b></span>
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
      <strong>{selectedMethod?.label || "Connect provider"}</strong>
      <span>Your provider credentials stay on Hub and are never sent to a provisioned workspace.</span>
    </div>

    {#if selectedMethod?.id === "oauth_redirect"}
      <div class="cloud-connect-action">
        <p>Continue in your system browser. After approving access, you will return to this step automatically.</p>
        <button class="btn cloud-primary" type="button" onclick={startAuthorization} disabled={loading}>{loading ? "Opening provider…" : selectedMethod.label}</button>
      </div>
    {:else if selectedMethod?.id === "assume_role"}
      <div class="cloud-connect-action">
        <p>Oyster connects AWS through a least-privilege IAM role and temporary credentials. Static access keys remain available under advanced options.</p>
        <label class="cloud-account-id">
          <span>AWS account ID</span>
          <input type="text" inputmode="numeric" pattern="[0-9]{12}" maxlength="12" bind:value={awsAccountId} placeholder="123456789012" required />
        </label>
        {#if !awsRoleFlow}
          <button class="btn cloud-primary" type="button" onclick={startAwsRole} disabled={loading || !/^\d{12}$/.test(awsAccountId)}>{loading ? "Preparing…" : "Prepare AWS setup"}</button>
        {:else}
          <p>Finish the CloudFormation stack in AWS, return here, then verify the connection.</p>
          <div class="cloud-role-actions">
            <a class="btn cloud-console-link" href={awsRoleFlow.setupUrl} target="_blank" rel="noopener noreferrer">Open AWS Console ↗</a>
            <button class="btn cloud-primary" type="button" onclick={verifyAwsRole} disabled={loading}>{loading ? "Verifying…" : "I've finished setup"}</button>
          </div>
        {/if}
      </div>
    {:else}
      {#if selectedProvider.id === "hetzner"}
        <ol class="cloud-token-steps">
          <li>Open your Hetzner Cloud project.</li>
          <li>Choose <strong>Security → API Tokens</strong> and create a read/write token.</li>
          <li>Return here and paste the token below.</li>
        </ol>
        <a class="btn cloud-console-link" href="https://console.hetzner.cloud/" target="_blank" rel="noopener noreferrer">Open Hetzner API tokens ↗</a>
      {/if}
      <form class="cloud-form" onsubmit={saveCredentials}>
        {#each credentialFields as field (field.id)}
          <label class:wide={["textarea", "file"].includes(field.type)}>
            <span>{field.label}{field.required ? " *" : ""}</span>
            {#if field.type === "file"}
              <input type="file" accept={field.accept || ".json,application/json"} required={field.required && !credentialValues[field.id]} onchange={(event) => updateCredentialFile(field.id, event.currentTarget.files?.[0])} />
              <small>Select the JSON key from Files. It is submitted directly to Hub and not retained by the browser.</small>
              <details class="cloud-file-paste"><summary>Paste JSON instead</summary><textarea rows="6" value={credentialValues[field.id] || ""} autocomplete="off" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)}></textarea></details>
            {:else if field.type === "textarea"}
              <textarea rows="8" value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} autocomplete="off" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)}></textarea>
            {:else}
              <input type={field.type} value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} required={field.required} autocomplete="off" autocapitalize="none" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)} />
            {/if}
          </label>
        {/each}
        <p class="cloud-secret-note">Credentials are written with owner-only permissions when the Hub has a cloud state file configured.</p>
        <button class="btn cloud-primary" type="submit" disabled={loading || !credentialsComplete}>{loading ? "Verifying access…" : `Connect ${selectedProvider.name}`}</button>
      </form>
    {/if}

    {#if ["hetzner", "gcp", "aws"].includes(selectedProvider.id) && !handoffId}
      <div class="cloud-handoff">
        <button type="button" onclick={startHandoff} disabled={loading || handoffFlow}>Continue on another device</button>
        {#if handoffFlow}
          <p>Authenticate to this Hub on the other device, then open this one-time link:</p>
          <div><input value={handoffFlow.url} readonly aria-label="One-time device handoff link" /><button type="button" onclick={copyHandoffUrl}>Copy</button></div>
          <small>Expires at {new Date(handoffFlow.expiresAt).toLocaleTimeString()}.</small>
          <button type="button" class="cloud-handoff-cancel" onclick={cancelHandoff}>Cancel handoff</button>
        {/if}
      </div>
    {/if}

    {#if handoffId}
      <button type="button" class="cloud-handoff-cancel" onclick={cancelHandoff}>Cancel device handoff</button>
    {/if}

    {#if methodsFor(selectedProvider).some((method) => method.advanced)}
      <button class="cloud-advanced-toggle" type="button" aria-expanded={advancedMethods} onclick={() => { advancedMethods = !advancedMethods; }}>
        Advanced connection options
      </button>
      {#if advancedMethods}
        <div class="cloud-method-list" role="list">
          {#each methodsFor(selectedProvider).filter((method) => method.advanced) as method (method.id)}
            <button type="button" class:active={selectedMethod?.id === method.id} onclick={() => chooseMethod(method.id)}>{method.label}</button>
          {/each}
        </div>
      {/if}
    {/if}
  {:else if step === "project"}
    <header class="cloud-section-head">
      <button type="button" class="cloud-back" onclick={() => { step = "providers"; error = ""; }}>←</button>
      <div><small>Google Cloud</small><h3>Choose a project</h3></div>
    </header>
    {#if loading}
      <div class="cloud-loading" role="status"><span></span><strong>Loading projects…</strong><small>This can take a few seconds for large organizations.</small></div>
    {:else}
      <form class="cloud-form" onsubmit={selectProject}>
        <label class="wide">
          <span>Project *</span>
          {#if projects.length}
            <select bind:value={projectId} required>
              {#each projects as project (project.id)}<option value={project.id}>{project.name} ({project.id})</option>{/each}
            </select>
          {:else}
            <input type="text" bind:value={projectId} placeholder="my-google-cloud-project" required autocapitalize="none" spellcheck="false" />
            <small>No projects were listed. Enter a project ID that your Google account can manage.</small>
          {/if}
        </label>
        <button class="btn cloud-primary wide" type="submit" disabled={loading || !projectId.trim()}>Use this project</button>
        {#if error}
          <a class="btn cloud-console-link wide" href={googleComputeConsoleUrl} target="_blank" rel="noopener noreferrer">Enable Compute Engine or review access ↗</a>
        {/if}
      </form>
    {/if}
  {:else if step === "instance"}
    <header class="cloud-section-head">
      <button type="button" class="cloud-back" onclick={() => { step = "providers"; error = ""; }}>←</button>
      <div><small>Provision with</small><h3>{selectedProvider.name}</h3></div>
      <div class="cloud-credential-actions">
        <button class="cloud-manage-credentials" type="button" onclick={configureCredentials}>Replace connection</button>
        <button class="cloud-manage-credentials danger" type="button" onclick={disconnectProvider}>Disconnect</button>
      </div>
    </header>
    {#if loading}
      <div class="cloud-loading" role="status"><span></span><strong>Querying available instances…</strong><small>This may take a few seconds.</small></div>
    {:else if options.regions.length}
      <form class="cloud-form instance" onsubmit={provision}>
        <label class="wide">
          <span>Environment name *</span>
          <input type="text" bind:value={environmentName} pattern="[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?" maxlength="63" placeholder="dev-cloud-1" title="Use 1–63 letters, numbers, or hyphens; start and end with a letter or number" required />
          <small>Cloud-init installs Oyster from the llmbox-cloud-feature source branch and registers this VM with Hub at wss://hub.get-oyster.dev/box/connect.</small>
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
