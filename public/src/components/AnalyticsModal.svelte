<script>
  import { analytics } from "../stores/analytics.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ANALYTICS_LOAD_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const load = (range = $analytics.range, bucket = $analytics.bucket) => uiActions.invoke(ANALYTICS_LOAD_ACTION, { range, bucket });
  const number = (value) => Number(value ?? 0).toLocaleString();
  const money = (value) => `$${Number(value ?? 0).toFixed(Number(value) >= 1 ? 2 : 4)}`;
  const bucketLabel = (value) => {
    const date = new Date(value);
    return $analytics.bucket === "hour"
      ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };
  $: maxModelCost = Math.max(0, ...$analytics.models.map((model) => model.cost));
</script>

<div class="analytics-controls">
  <label>Range
    <select value={$analytics.range} onchange={(event) => load(event.currentTarget.value, $analytics.bucket)}>
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d">Last 90 days</option>
      <option value="all">All time</option>
    </select>
  </label>
  <label>Group by
    <select value={$analytics.bucket} onchange={(event) => load($analytics.range, event.currentTarget.value)}>
      <option value="hour">Hour</option>
      <option value="day">Day</option>
    </select>
  </label>
  <button class="chip" onclick={() => load()}>Refresh</button>
</div>

{#if $analytics.loading}
  <div class="m-path"><span class="spin"></span> aggregating SQLite usage…</div>
{:else if $analytics.error}
  <div class="analytics-error">{$analytics.error}</div>
{:else}
  <div class="analytics-summary">
    <div><strong>{money($analytics.total.cost)}</strong><span>cost</span></div>
    <div><strong>{number($analytics.total.requests)}</strong><span>responses</span></div>
    <div><strong>{number($analytics.total.input)}</strong><span>input tokens</span></div>
    <div><strong>{number($analytics.total.output)}</strong><span>output tokens</span></div>
    <div><strong>{number($analytics.total.cacheRead)}</strong><span>cache read</span></div>
    <div><strong>{number($analytics.total.reasoning)}</strong><span>reasoning</span></div>
  </div>

  <h3 class="analytics-heading">By model</h3>
  {#if !$analytics.models.length}
    <div class="m-path">No usage in this range.</div>
  {:else}
    <div class="analytics-models">
      {#each $analytics.models as model (model.model)}
        <div class="analytics-model-row">
          <div class="analytics-model-name" title={model.model}>{model.model}</div>
          <div class="analytics-bar"><i style:width={`${maxModelCost ? Math.max(2, model.cost / maxModelCost * 100) : 0}%`}></i></div>
          <span>{money(model.cost)}</span><span>{number(model.totalTokens)} tok</span><span>{number(model.requests)} calls</span>
        </div>
      {/each}
    </div>
  {/if}

  <h3 class="analytics-heading">Timeline</h3>
  <div class="analytics-timeline">
    {#each $analytics.series as row (`${row.bucket}:${row.model}`)}
      <div class="analytics-time-row">
        <time>{bucketLabel(row.bucket)}</time>
        <span class="analytics-time-model" title={row.model}>{row.model}</span>
        <span>{money(row.cost)}</span>
        <span>{number(row.totalTokens)} tok</span>
      </div>
    {/each}
  </div>
{/if}

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
