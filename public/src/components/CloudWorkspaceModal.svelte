<script>
  import { onDestroy, onMount } from "svelte";
  import { closeModalState } from "../stores/modal.js";
  import { publishWorkspace } from "../stores/workspaces.js";
  import { getWorkspaceService } from "../runtime/workspaceServiceContext.js";
  import { cloudBrowser } from "../features/cloud/cloudBrowser.js";
  import { createAsyncRequestGuard } from "../lib/asyncRequestGuard.js";

  export let providerId = "";

  const workspaceService = getWorkspaceService();

  let providers = [];
  let selectedProvider = null;
  let step = "providers";
  let loading = true;
  let error = "";
  let credentialValues = {};
  let selectedMethodId = "";
  let advancedMethodsOpen = false;
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
  let workspaceName = "";
  let region = "";
  let size = "";
  let image = "";
  let createdWorkspace = null;
  let handoffCheckInFlight = false;
  let awsRoleCheckInFlight = false;
  const lifecycleRequests = createAsyncRequestGuard();
  const lifecycle = lifecycleRequests.begin();
  const actionRequests = createAsyncRequestGuard();
  const providerRequests = createAsyncRequestGuard();
  const projectRequests = createAsyncRequestGuard();
  const optionRequests = createAsyncRequestGuard();
  const handoffRequests = createAsyncRequestGuard();
  const awsRoleRequests = createAsyncRequestGuard();
  const credentialFileRequests = createAsyncRequestGuard();

  async function loadProviders() {
    const request = providerRequests.begin();
    loading = true;
    error = "";
    try {
      const availableProviders = await workspaceService.listCloudProviders();
      if (request.isCurrent()) providers = availableProviders;
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Cloud providers could not be loaded");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  function errorMessage(cause, fallback = "Something went wrong") {
    return cause instanceof Error && cause.message ? cause.message : fallback;
  }

  function methodsFor(provider) {
    return (provider?.authMethods || []).filter((method) => method.available !== false);
  }

  function stopHandoffPolling() {
    clearInterval(handoffTimer);
    handoffTimer = null;
  }

  function stopAwsRolePolling() {
    clearInterval(awsRoleTimer);
    awsRoleTimer = null;
  }

  function returnToProviders() {
    actionRequests.begin();
    projectRequests.begin();
    optionRequests.begin();
    handoffRequests.begin();
    awsRoleRequests.begin();
    credentialFileRequests.begin();
    stopHandoffPolling();
    stopAwsRolePolling();
    handoffFlow = null;
    handoffId = "";
    awsRoleFlow = null;
    authorizationFlow = null;
    selectedProvider = null;
    loading = false;
    error = "";
    step = "providers";
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
    projectRequests.begin();
    optionRequests.begin();
    stopHandoffPolling();
    stopAwsRolePolling();
    handoffFlow = null;
    handoffId = "";
    awsRoleFlow = null;
    authorizationFlow = null;
    selectedProvider = provider;
    credentialValues = {};
    advancedMethodsOpen = false;
    selectedMethodId = primaryMethod(provider)?.id || "";
    error = "";
    if (provider.configured && provider.requiresProject) loadProjects();
    else if (provider.configured) loadOptions();
    else step = "credentials";
  }

  async function disconnectProvider() {
    const provider = selectedProvider;
    const upstream = provider.id === "gcp"
      ? "Oyster will also request Google token revocation."
      : "This removes Hub's credential but may not revoke it at the provider.";
    if (!confirm(`Disconnect ${provider.name}?\n\n${upstream}`)) return;
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      await workspaceService.disconnectCloudProvider(provider.id);
      if (!request.isCurrent()) return;
      await loadProviders();
      if (!request.isCurrent()) return;
      selectedProvider = null;
      step = "providers";
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Cloud provider could not be disconnected");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  function configureCredentials() {
    credentialValues = {};
    advancedMethodsOpen = false;
    selectedMethodId = primaryMethod(selectedProvider)?.id || "";
    error = "";
    step = "credentials";
  }

  async function startAuthorization() {
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      const flow = await workspaceService.startCloudAuthorization(selectedProvider.id);
      if (!request.isCurrent()) return;
      authorizationFlow = flow;
      cloudBrowser.navigate(authorizationFlow.authorizationUrl);
    } catch (cause) {
      if (request.isCurrent()) {
        error = errorMessage(cause, "Cloud sign-in could not be started");
        loading = false;
      }
    }
  }

  async function startAwsRole() {
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      const flow = await workspaceService.startAwsRole(awsAccountId);
      if (!request.isCurrent()) return;
      awsRoleFlow = flow;
      stopAwsRolePolling();
      awsRoleTimer = setInterval(() => { void verifyAwsRole({ quiet: true }); }, 4_000);
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "AWS setup could not be started");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  async function verifyAwsRole({ quiet = false } = {}) {
    if (!awsRoleFlow || loading || awsRoleCheckInFlight || cloudBrowser.hidden()) return;
    const request = awsRoleRequests.begin();
    const flowId = awsRoleFlow.id;
    awsRoleCheckInFlight = true;
    if (!quiet) loading = true;
    if (!quiet) error = "";
    try {
      const flow = await workspaceService.verifyAwsRole(flowId);
      if (!request.isCurrent()) return;
      awsRoleFlow = flow;
      if (awsRoleFlow.status === "succeeded") {
        stopAwsRolePolling();
        await loadProviders();
        if (!request.isCurrent()) return;
        selectedProvider = providers.find((provider) => provider.id === "aws");
        await loadOptions();
      } else if (!quiet) error = awsRoleFlow.error || "The AWS role is not ready yet.";
    } catch (cause) {
      if (request.isCurrent() && !quiet) error = errorMessage(cause, "AWS connection could not be verified");
    } finally {
      awsRoleCheckInFlight = false;
      if (request.isCurrent() && !quiet) loading = false;
    }
  }

  async function restoreAuthorization(flowId) {
    try {
      const flow = await workspaceService.getCloudAuthorization(flowId);
      if (!lifecycle.isCurrent()) return;
      authorizationFlow = flow;
      selectedProvider = providers.find((provider) => provider.id === authorizationFlow.provider) || null;
      if (!selectedProvider) throw new Error("Connected cloud provider is unavailable");
      selectedMethodId = "oauth_redirect";
      cloudBrowser.removeQuery("cloud-connect");
      if (authorizationFlow.status !== "succeeded") {
        step = "credentials";
        throw new Error(authorizationFlow.error || "Cloud sign-in did not complete");
      }
      await loadProviders();
      if (!lifecycle.isCurrent()) return;
      selectedProvider = providers.find((provider) => provider.id === authorizationFlow.provider) || selectedProvider;
      if (authorizationFlow.requiresProject || selectedProvider.requiresProject) await loadProjects();
      else await loadOptions();
    } catch (cause) {
      if (lifecycle.isCurrent()) {
        error = errorMessage(cause, "Cloud sign-in could not be restored");
        loading = false;
      }
    }
  }

  async function loadProjects() {
    const request = projectRequests.begin();
    const requestedProviderId = selectedProvider.id;
    step = "project";
    loading = true;
    error = "";
    try {
      const availableProjects = await workspaceService.listCloudProjects(requestedProviderId);
      if (!request.isCurrent()) return;
      projects = availableProjects;
      projectId = projects[0]?.id || "";
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Cloud projects could not be loaded");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  async function selectProject(event) {
    event.preventDefault();
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      await workspaceService.selectCloudProject(selectedProvider.id, projectId);
      if (!request.isCurrent()) return;
      await loadOptions();
    } catch (cause) {
      if (request.isCurrent()) {
        error = errorMessage(cause, "Cloud project could not be selected");
        loading = false;
      }
    }
  }

  async function startHandoff() {
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      const flow = await workspaceService.startCloudHandoff(selectedProvider.id);
      if (!request.isCurrent()) return;
      handoffFlow = { ...flow, url: cloudBrowser.handoffUrl(flow.id) };
      stopHandoffPolling();
      handoffTimer = setInterval(() => { void checkHandoff(); }, 2_000);
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Device handoff could not be started");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  async function checkHandoff() {
    if (!handoffFlow || handoffCheckInFlight || cloudBrowser.hidden()) return;
    const request = handoffRequests.begin();
    const flowId = handoffFlow.id;
    handoffCheckInFlight = true;
    try {
      const flow = await workspaceService.getCloudHandoff(flowId);
      if (!request.isCurrent()) return;
      handoffFlow = { ...handoffFlow, ...flow };
      if (flow.status === "succeeded") {
        stopHandoffPolling();
        await loadProviders();
        if (!request.isCurrent()) return;
        selectedProvider = providers.find((provider) => provider.id === flow.provider);
        if (selectedProvider?.requiresProject) await loadProjects();
        else if (selectedProvider) await loadOptions();
      }
    } catch (cause) {
      if (!request.isCurrent()) return;
      stopHandoffPolling();
      error = errorMessage(cause, "Device handoff status could not be checked");
    } finally {
      handoffCheckInFlight = false;
    }
  }

  async function copyHandoffUrl() {
    try { await cloudBrowser.copyText(handoffFlow.url); }
    catch { if (lifecycle.isCurrent()) error = "Copy failed. Select and copy the link manually."; }
  }

  async function cancelHandoff() {
    const id = handoffFlow?.id || handoffId;
    if (!id) return;
    handoffRequests.begin();
    try { await workspaceService.cancelCloudHandoff(id); }
    catch {}
    if (!lifecycle.isCurrent()) return;
    stopHandoffPolling();
    handoffFlow = null;
    if (handoffId) {
      handoffId = "";
      credentialValues = {};
      step = "providers";
    }
  }

  async function saveCredentials(event) {
    event.preventDefault();
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      await workspaceService.saveCloudCredentials(selectedProvider.id, {
        ...credentialValues,
        ...(handoffId ? { handoffId } : {}),
      });
      if (!request.isCurrent()) return;
      providers = providers.map((provider) => provider.id === selectedProvider.id ? { ...provider, configured: true } : provider);
      selectedProvider = providers.find((provider) => provider.id === selectedProvider.id);
      credentialValues = {};
      if (selectedProvider.id === "gcp" && selectedMethodId === "oauth_redirect") await loadProjects();
      else await loadOptions();
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Cloud credentials could not be saved");
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  async function loadOptions(requestedRegion = "") {
    const request = optionRequests.begin();
    const requestedProviderId = selectedProvider.id;
    step = "instance";
    loading = true;
    error = "";
    try {
      const availableOptions = await workspaceService.getCloudOptions(requestedProviderId, requestedRegion);
      if (!request.isCurrent()) return;
      options = availableOptions;
      region = options.defaults.region || requestedRegion || options.regions[0]?.id || "";
      const regionSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, region));
      size = regionSizes.some((item) => item.id === options.defaults.size) ? options.defaults.size : regionSizes[0]?.id || "";
      const regionImages = options.images.filter((item) => imageAvailableForSelection(item, region, size));
      image = regionImages.some((item) => item.id === options.defaults.image) ? options.defaults.image : regionImages[0]?.id || "";
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Cloud instance options could not be loaded");
    } finally {
      if (request.isCurrent()) loading = false;
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
    const request = actionRequests.begin();
    loading = true;
    error = "";
    try {
      const workspace = await workspaceService.provisionCloudWorkspace({
        provider: selectedProvider.id,
        name: workspaceName,
        region,
        size,
        image,
      });
      if (!request.isCurrent()) return;
      createdWorkspace = workspace;
      step = "done";
      publishWorkspace(createdWorkspace);
    } catch (cause) {
      if (request.isCurrent()) error = provisioningError(cause);
    } finally {
      if (request.isCurrent()) loading = false;
    }
  }

  function updateCredential(fieldId, value) {
    credentialValues = { ...credentialValues, [fieldId]: value };
  }

  async function updateCredentialFile(fieldId, file) {
    const request = credentialFileRequests.begin();
    if (!file) return updateCredential(fieldId, "");
    if (file.size > 64 * 1024) {
      error = "Credential file is too large";
      return;
    }
    error = "";
    try {
      const content = await file.text();
      if (request.isCurrent()) updateCredential(fieldId, content);
    } catch (cause) {
      if (request.isCurrent()) error = errorMessage(cause, "Credential file could not be read");
    }
  }

  function resumeExternalSetup() {
    if (cloudBrowser.hidden()) return;
    if (handoffFlow) void checkHandoff();
    if (awsRoleFlow) void verifyAwsRole({ quiet: true });
  }

  async function initialize() {
    releaseBrowserResume = cloudBrowser.onResume(resumeExternalSetup);
    await loadProviders();
    if (!lifecycle.isCurrent()) return;
    const flowId = cloudBrowser.query("cloud-connect");
    if (flowId) await restoreAuthorization(flowId);
    const deviceFlowId = cloudBrowser.query("cloud-handoff");
    if (deviceFlowId && lifecycle.isCurrent()) {
      try {
        const flow = await workspaceService.getCloudHandoff(deviceFlowId);
        if (!lifecycle.isCurrent()) return;
        handoffId = deviceFlowId;
        cloudBrowser.removeQuery("cloud-handoff");
        selectedProvider = providers.find((provider) => provider.id === flow.provider);
        selectedMethodId = methodsFor(selectedProvider).find((method) => ["api_token", "access_key", "service_account_file"].includes(method.id))?.id || primaryMethod(selectedProvider)?.id || "";
        advancedMethodsOpen = true;
        step = "credentials";
      } catch (cause) {
        if (lifecycle.isCurrent()) error = errorMessage(cause, "Device handoff could not be restored");
      }
    } else if (!flowId && providerId && lifecycle.isCurrent()) {
      const provider = providers.find((candidate) => candidate.id === providerId);
      if (provider) chooseProvider(provider);
    }
  }

  $: selectedMethod = methodsFor(selectedProvider).find((method) => method.id === selectedMethodId) || primaryMethod(selectedProvider);
  $: advancedAuthMethods = methodsFor(selectedProvider).filter((method) => method.advanced);
  $: handoffExpiryLabel = handoffFlow ? new Date(handoffFlow.expiresAt).toLocaleTimeString() : "";
  $: credentialFields = selectedMethod?.fields || [];
  $: googleComputeConsoleUrl = workspaceService.googleComputeConsoleUrl(projectId);
  $: availableSizes = options.sizes.filter((item) => sizeAvailableInRegion(item, region));
  $: selectedSize = options.sizes.find((item) => item.id === size);
  $: selectedSizeAvailability = selectedProvider?.id === "digitalocean" && selectedSize ? regionAvailability(selectedSize) : "";
  $: availableImages = options.images.filter((item) => imageAvailableForSelection(item, region, size));

  onMount(() => { void initialize(); });
  onDestroy(() => {
    lifecycleRequests.invalidate();
    actionRequests.invalidate();
    providerRequests.invalidate();
    projectRequests.invalidate();
    optionRequests.invalidate();
    handoffRequests.invalidate();
    awsRoleRequests.invalidate();
    credentialFileRequests.invalidate();
    stopHandoffPolling();
    stopAwsRolePolling();
    releaseBrowserResume();
    credentialValues = {};
  });
</script>

<section class="cloud-workspace-modal" aria-label="Cloud workspace provisioning" aria-busy={loading} aria-describedby={error ? "cloudWorkspaceError" : undefined}>
  <nav class="cloud-steps" aria-label="Provisioning steps">
    <span class:active={step === "providers"} class:complete={step !== "providers"} aria-current={step === "providers" ? "step" : undefined}>1 <b>Provider</b></span>
    <i></i>
    <span class:active={["credentials", "project"].includes(step)} class:complete={["instance", "done"].includes(step)} aria-current={["credentials", "project"].includes(step) ? "step" : undefined}>2 <b>Connect</b></span>
    <i></i>
    <span class:active={step === "instance"} class:complete={step === "done"} aria-current={step === "instance" ? "step" : undefined}>3 <b>Instance</b></span>
  </nav>

  {#if step === "providers"}
    <p class="cloud-intro">Choose the cloud-provider environment for the new workspace. Hub provisions an Ubuntu VM, installs Oyster from source with cloud-init, and registers it over outbound WSS. Provider credentials remain on Hub.</p>
    {#if loading}<p class="cloud-state" role="status">Loading cloud providers…</p>{/if}
    {#if !loading && !providers.length && !error}
      <p class="cloud-state" role="status">No cloud providers are available.</p>
    {/if}
    <div class="cloud-provider-grid">
      {#each providers as provider (provider.id)}
        <button class="cloud-provider-card" type="button" onclick={() => chooseProvider(provider)} disabled={loading}>
          <span class={`cloud-provider-icon ${provider.id}`} aria-hidden="true">{providerIcon(provider.id)}</span>
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
      <button type="button" class="chip cloud-back" aria-label="Back to cloud providers" title="Back to cloud providers" onclick={returnToProviders}>←</button>
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
      <form class="cloud-connect-action" onsubmit={(event) => { event.preventDefault(); startAwsRole(); }}>
        <p>Oyster connects AWS through a least-privilege IAM role and temporary credentials. Static access keys remain available under advanced options.</p>
        <label class="cloud-account-id">
          <span>AWS account ID</span>
          <input type="text" inputmode="numeric" pattern="[0-9]{12}" maxlength="12" bind:value={awsAccountId} placeholder="123456789012" required />
        </label>
        {#if !awsRoleFlow}
          <button class="btn cloud-primary" type="submit" disabled={loading}>{loading ? "Preparing…" : "Prepare AWS setup"}</button>
        {:else}
          <p>Finish the CloudFormation stack in AWS, return here, then verify the connection.</p>
          <div class="cloud-role-actions">
            <a class="btn cloud-console-link" href={awsRoleFlow.setupUrl} target="_blank" rel="noopener noreferrer">Open AWS Console ↗</a>
            <button class="btn cloud-primary" type="button" onclick={verifyAwsRole} disabled={loading}>{loading ? "Verifying…" : "I've finished setup"}</button>
          </div>
        {/if}
      </form>
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
              <details class="cloud-file-paste"><summary>Paste JSON instead</summary><textarea aria-label={`Paste ${field.label}`} rows="6" value={credentialValues[field.id] || ""} autocomplete="off" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)}></textarea></details>
            {:else if field.type === "textarea"}
              <textarea rows="8" value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} required={field.required} autocomplete="off" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)}></textarea>
            {:else}
              <input type={field.type} value={credentialValues[field.id] || ""} placeholder={field.placeholder || ""} required={field.required} autocomplete="off" autocapitalize="none" spellcheck="false" oninput={(event) => updateCredential(field.id, event.currentTarget.value)} />
            {/if}
          </label>
        {/each}
        <p class="cloud-secret-note">Credentials are written with owner-only permissions when the Hub has a cloud state file configured.</p>
        <button class="btn cloud-primary" type="submit" disabled={loading}>{loading ? "Verifying access…" : `Connect ${selectedProvider.name}`}</button>
      </form>
    {/if}

    {#if ["hetzner", "gcp", "aws"].includes(selectedProvider.id) && !handoffId}
      <div class="cloud-handoff">
        <button type="button" onclick={startHandoff} disabled={loading || handoffFlow}>Continue on another device</button>
        {#if handoffFlow}
          <p>Authenticate to this Hub on the other device, then open this one-time link:</p>
          <div><input value={handoffFlow.url} readonly aria-label="One-time device handoff link" /><button type="button" onclick={copyHandoffUrl}>Copy</button></div>
          <small>Expires at {handoffExpiryLabel}.</small>
          <button type="button" class="cloud-handoff-cancel" onclick={cancelHandoff}>Cancel handoff</button>
        {/if}
      </div>
    {/if}

    {#if handoffId}
      <button type="button" class="cloud-handoff-cancel" onclick={cancelHandoff}>Cancel device handoff</button>
    {/if}

    {#if advancedAuthMethods.length}
      <button class="cloud-advanced-toggle" type="button" aria-expanded={advancedMethodsOpen} aria-controls="cloudAdvancedMethods" onclick={() => { advancedMethodsOpen = !advancedMethodsOpen; }}>
        Advanced connection options
      </button>
      {#if advancedMethodsOpen}
        <div id="cloudAdvancedMethods" class="cloud-method-list" aria-label="Advanced connection methods">
          {#each advancedAuthMethods as method (method.id)}
            <button type="button" class:active={selectedMethod?.id === method.id} aria-pressed={selectedMethod?.id === method.id} onclick={() => chooseMethod(method.id)}>{method.label}</button>
          {/each}
        </div>
      {/if}
    {/if}
  {:else if step === "project"}
    <header class="cloud-section-head">
      <button type="button" class="chip cloud-back" aria-label="Back to cloud providers" title="Back to cloud providers" onclick={returnToProviders}>←</button>
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
      <button type="button" class="chip cloud-back" aria-label="Back to cloud providers" title="Back to cloud providers" onclick={returnToProviders}>←</button>
      <div><small>Provision with</small><h3>{selectedProvider.name}</h3></div>
      <div class="cloud-credential-actions">
        <button class="chip cloud-manage-credentials" type="button" onclick={configureCredentials}>Replace connection</button>
        <button class="chip cloud-manage-credentials danger" type="button" onclick={disconnectProvider} disabled={loading}>Disconnect</button>
      </div>
    </header>
    {#if loading}
      <div class="cloud-loading" role="status"><span></span><strong>Querying available instances…</strong><small>This may take a few seconds.</small></div>
    {:else if options.regions.length}
      <form class="cloud-form instance" onsubmit={provision}>
        <label class="wide">
          <span>Workspace name *</span>
          <input type="text" bind:value={workspaceName} pattern="[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?" maxlength="63" placeholder="dev-cloud-1" title="Use 1–63 letters, numbers, or hyphens; start and end with a letter or number" required />
          <small>Cloud-init installs the configured Oyster source and registers this VM with Hub over outbound WSS.</small>
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
        <button class="btn cloud-primary wide" type="submit" disabled={loading}>{loading ? "Provisioning…" : "Provision Oyster workspace"}</button>
      </form>
    {:else if !error}
      <p class="cloud-state">No available regions or zones were returned by this provider.</p>
    {/if}
  {:else if step === "done"}
    <div class="cloud-success">
      <span class="cloud-success-icon" aria-hidden="true">✓</span>
      <small>Provisioning started</small>
      <h3>{createdWorkspace.name}</h3>
      <p>The workspace VM was created with Oyster cloud-init. It appears immediately as awaiting agent while the source build runs, then registers itself with Hub and becomes online.</p>
      <dl>
        <div><dt>Environment</dt><dd>{createdWorkspace.environmentName}</dd></div>
        <div><dt>Provider</dt><dd>{createdWorkspace.provider.name}</dd></div>
        <div><dt>Instance</dt><dd>{createdWorkspace.provider.instanceId}</dd></div>
        <div><dt>Location</dt><dd>{createdWorkspace.provider.region}</dd></div>
        <div><dt>Type</dt><dd>{createdWorkspace.provider.size}</dd></div>
      </dl>
      {#if createdWorkspace.provider.consoleUrl}<a class="btn cloud-console-link" href={createdWorkspace.provider.consoleUrl} target="_blank" rel="noopener noreferrer">Open provider console ↗</a>{/if}
    </div>
  {/if}

  {#if error}<p id="cloudWorkspaceError" class="cloud-error" role="alert" aria-atomic="true">{error}</p>{/if}
</section>

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={closeModalState}>{step === "done" ? "Done" : "Cancel"}</button>
</div>

<style>
  .cloud-workspace-modal {
    min-height: 330px;
    color: var(--text);
  }

  .cloud-steps {
    display: flex;
    align-items: center;
    margin: 1px 0 18px;
    color: var(--muted);
  }

  .cloud-steps span {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    white-space: nowrap;
  }

  .cloud-steps span b { font-weight: 600; }
  .cloud-steps span.active { color: var(--accent); }
  .cloud-steps span.complete { color: var(--green); }
  .cloud-steps span.complete::after { content: "✓"; font-size: 9px; }

  .cloud-steps i {
    height: 1px;
    flex: 1;
    margin: 0 10px;
    background: var(--border);
  }

  .cloud-intro,
  .cloud-state {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .cloud-intro { max-width: 600px; margin: 0 0 14px; }
  .cloud-state { margin: 12px 0; }

  .cloud-provider-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
  }

  .cloud-provider-card {
    display: grid;
    min-width: 0;
    min-height: 180px;
    grid-template-rows: auto 1fr auto;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--panel) 86%, transparent);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 140ms, background 140ms, transform 140ms;
  }

  .cloud-provider-card:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent-dim) 18%, var(--panel));
    transform: translateY(-1px);
  }

  .cloud-provider-card:disabled { opacity: .45; cursor: not-allowed; }

  .cloud-provider-icon {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 10px;
    background: #1775e5;
    color: white;
    font-size: 11px;
    font-weight: 800;
  }

  .cloud-provider-icon.aws { background: #202b3c; color: #ffb84d; font-size: 9px; }
  .cloud-provider-icon.gcp { background: white; color: #4285f4; font-size: 20px; }
  .cloud-provider-icon.hetzner { background: #d50c2d; color: white; font-size: 10px; }
  .cloud-provider-copy { display: grid; min-width: 0; align-content: start; gap: 5px; }
  .cloud-provider-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .cloud-provider-copy small { color: var(--muted); font-size: 10.5px; line-height: 1.4; overflow-wrap: anywhere; }

  .cloud-provider-status {
    width: fit-content;
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    font-size: 9px;
  }

  .cloud-provider-status.configured {
    border-color: color-mix(in srgb, var(--green) 32%, var(--border));
    background: color-mix(in srgb, var(--green) 12%, transparent);
    color: var(--green);
  }

  .cloud-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .cloud-section-head > div { display: grid; min-width: 0; gap: 1px; }
  .cloud-section-head small { color: var(--muted); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
  .cloud-section-head h3 { margin: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }

  .chip.cloud-back {
    width: 32px;
    min-width: 32px;
    height: 32px;
    padding: 0;
    font-size: 17px;
  }

  .cloud-credential-actions { display: flex; margin-left: auto; gap: 6px; }
  .chip.cloud-manage-credentials { color: var(--accent); font-size: 10px; }
  .chip.cloud-manage-credentials.danger { color: var(--red); }

  .cloud-auth-note,
  .cloud-connect-action {
    display: grid;
    margin-bottom: 14px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 90%, transparent);
  }

  .cloud-auth-note {
    gap: 2px;
    padding: 10px 12px;
    border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
    border-radius: 9px;
  }

  .cloud-auth-note strong { font-size: 11px; }
  .cloud-auth-note span { color: var(--muted); font-size: 10px; line-height: 1.45; }
  .cloud-connect-action { justify-items: start; gap: 10px; padding: 16px; border-radius: 10px; }
  .cloud-connect-action p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }

  .cloud-account-id,
  .cloud-form label {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: 5px;
    color: var(--muted);
    font-size: 10.5px;
  }

  .cloud-account-id { width: min(100%, 280px); }
  .cloud-account-id input,
  .cloud-form input,
  .cloud-form select,
  .cloud-form textarea,
  .cloud-handoff input {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    outline: none;
    transition: border-color 140ms, box-shadow 140ms;
  }

  .cloud-account-id input,
  .cloud-form input,
  .cloud-form select { height: 38px; padding: 8px 10px; }
  .cloud-account-id input { font-family: var(--mono); }
  .cloud-form textarea { padding: 8px 10px; resize: vertical; font: 10px var(--mono); }
  .cloud-account-id input:focus,
  .cloud-form :is(input, select, textarea):focus,
  .cloud-handoff input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }

  .cloud-role-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .cloud-token-steps { display: grid; gap: 6px; margin: 0 0 12px; padding-left: 22px; color: var(--muted); font-size: 11px; line-height: 1.45; }
  .cloud-console-link { text-decoration: none; }

  .cloud-advanced-toggle,
  .cloud-handoff > button,
  .cloud-handoff-cancel {
    min-height: 30px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
  }

  .cloud-advanced-toggle { margin-top: 12px; }
  .cloud-advanced-toggle:hover,
  .cloud-handoff > button:hover:not(:disabled),
  .cloud-handoff-cancel:hover { text-decoration: underline; }
  .cloud-handoff-cancel { margin-top: 4px; color: var(--red); font-size: 10px; }

  .cloud-method-list { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
  .cloud-method-list button {
    min-height: 30px;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel-2);
    color: var(--muted);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .cloud-method-list button:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); color: var(--text); }
  .cloud-method-list button.active { border-color: var(--selection-border); background: var(--selection-bg); color: var(--selection-text); font-weight: 600; box-shadow: inset 0 -1px 0 var(--selection-marker); }

  .cloud-handoff { display: grid; justify-items: start; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .cloud-handoff p,
  .cloud-handoff small { margin: 0; color: var(--muted); font-size: 9.5px; line-height: 1.4; }
  .cloud-handoff > div { display: flex; width: 100%; min-width: 0; gap: 6px; }
  .cloud-handoff input { flex: 1; padding: 7px 8px; font: 10px var(--mono); }
  .cloud-handoff div button { min-height: 32px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); color: var(--text); cursor: pointer; }

  .cloud-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
  .cloud-form label.wide,
  .cloud-form .wide,
  .cloud-secret-note { grid-column: 1 / -1; }
  .cloud-file-paste summary { min-height: 30px; padding: 6px 0; color: var(--accent); cursor: pointer; }
  .cloud-file-paste textarea { margin-top: 4px; }
  .cloud-form label > small,
  .cloud-secret-note,
  .cloud-required-hint { color: var(--muted); font-size: 9.5px; line-height: 1.4; }
  .cloud-secret-note { margin: 0; }
  .cloud-required-hint { margin: -2px 0 0; }
  .cloud-primary { width: fit-content; justify-self: end; }
  .cloud-form .cloud-primary.wide { width: 100%; margin-top: 2px; justify-self: stretch; }

  .cloud-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel);
  }

  .cloud-summary span { display: grid; min-width: 0; gap: 1px; }
  .cloud-summary small,
  .cloud-success dt { color: var(--muted); font-size: 8px; letter-spacing: .06em; text-transform: uppercase; }
  .cloud-summary strong { overflow: hidden; font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }

  .cloud-loading { display: grid; justify-items: center; gap: 5px; padding: 55px 10px; text-align: center; }
  .cloud-loading span { width: 25px; height: 25px; margin-bottom: 5px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: cloud-spin .7s linear infinite; }
  .cloud-loading strong { font-size: 12px; }
  .cloud-loading small { color: var(--muted); font-size: 10px; }

  .cloud-error {
    margin: 12px 0 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--red) 45%, var(--border));
    border-radius: 8px;
    background: color-mix(in srgb, var(--red) 8%, transparent);
    color: var(--red);
    font-size: 11px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .cloud-success { display: grid; max-width: 520px; justify-items: center; margin: 12px auto 0; text-align: center; }
  .cloud-success-icon { display: grid; width: 45px; height: 45px; place-items: center; margin-bottom: 9px; border-radius: 50%; background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); font-size: 23px; }
  .cloud-success > small { color: var(--green); font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .cloud-success h3 { max-width: 100%; margin: 3px 0; overflow-wrap: anywhere; font-size: 19px; }
  .cloud-success p { max-width: 460px; margin: 4px 0 14px; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .cloud-success dl { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0 0 13px; overflow: hidden; border: 1px solid var(--border); border-radius: 9px; text-align: left; }
  .cloud-success dl div { min-width: 0; padding: 8px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .cloud-success dl div:nth-child(2n) { border-right: 0; }
  .cloud-success dl div:nth-last-child(-n+2) { border-bottom: 0; }
  .cloud-success dd { margin: 1px 0 0; overflow: hidden; font: 10.5px var(--mono); text-overflow: ellipsis; white-space: nowrap; }

  @keyframes cloud-spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    .cloud-provider-card,
    .cloud-method-list button,
    .cloud-advanced-toggle,
    .cloud-handoff button { min-height: 40px; }
  }

  @media (max-width: 600px) {
    .cloud-workspace-modal { min-height: min(70vh, 620px); }
    .cloud-provider-grid,
    .cloud-form { grid-template-columns: 1fr; }
    .cloud-provider-card { min-height: 0; grid-template-rows: auto; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; padding: 11px; }
    .cloud-form label.wide,
    .cloud-form .wide,
    .cloud-secret-note { grid-column: 1; }
    .cloud-steps span b { display: none; }
    .cloud-credential-actions { width: 100%; margin: 6px 0 0; }
    .cloud-section-head { flex-wrap: wrap; }
    .cloud-summary { grid-template-columns: 1fr; }
    .cloud-success dl { grid-template-columns: 1fr; }
    .cloud-success dl div { border-right: 0; }
    .cloud-success dl div:nth-last-child(2) { border-bottom: 1px solid var(--border); }
  }

  @media (max-width: 520px) {
    .cloud-provider-status { max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cloud-role-actions { width: 100%; flex-direction: column; }
    .cloud-role-actions .btn { width: 100%; }
  }
</style>
