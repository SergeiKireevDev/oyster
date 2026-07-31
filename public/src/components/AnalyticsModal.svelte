<script>
  import { analytics } from "../stores/analytics.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ANALYTICS_LOAD_ACTION } from "../runtime/uiActionNames.js";

  const CHART_COLORS = ["#7c8cff", "#39c6a3", "#f2ad4b", "#e26d8d", "#9b7de3", "#54a8e8", "#86b84b", "#dc7658"];
  const integerFormatter = new Intl.NumberFormat();
  const uiActions = getUiActionRegistry();

  const finiteNumber = (value) => {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  };
  const formatNumber = (value) => integerFormatter.format(finiteNumber(value));
  const money = (value) => {
    const numericValue = finiteNumber(value);
    return `$${numericValue.toFixed(Math.abs(numericValue) >= 1 ? 2 : 4)}`;
  };
  const bucketLabel = (value, bucket) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return bucket === "hour"
      ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };
  const maximumCost = (items) => items.reduce((maximum, item) => Math.max(maximum, finiteNumber(item.cost)), 0);
  const makeChart = (series) => {
    const buckets = new Map();
    for (const row of series) {
      const bucket = String(row.bucket);
      const model = String(row.model);
      const cost = finiteNumber(row.cost);
      if (!buckets.has(bucket)) buckets.set(bucket, { bucket, cost: 0, modelCosts: new Map() });
      const item = buckets.get(bucket);
      item.cost += cost;
      item.modelCosts.set(model, (item.modelCosts.get(model) ?? 0) + cost);
    }
    return [...buckets.values()]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map(({ modelCosts, ...item }) => ({ ...item, rows: [...modelCosts].map(([model, cost]) => ({ model, cost })) }));
  };
  const chartTitle = (item, bucket) => [bucketLabel(item.bucket, bucket), `Total: ${money(item.cost)}`, ...item.rows.map((row) => `${row.model}: ${money(row.cost)}`)].join("\n");
  const percentage = (value, total, minimum) => total > 0 && value > 0 ? Math.max(minimum, value / total * 100) : 0;
  const modelBarWidth = (model) => `${percentage(finiteNumber(model.cost), maxModelCost, 2)}%`;
  const chartBarHeight = (item) => `${percentage(item.cost, maxChartCost, 1)}%`;
  const chartSegmentBasis = (row, item) => `${percentage(row.cost, item.cost, 0)}%`;
  const chartLabelVisible = (index) => index % chartLabelEvery === 0 || index === chartData.length - 1;
  const load = (range = $analytics.range, bucket = $analytics.bucket) => uiActions.invoke(ANALYTICS_LOAD_ACTION, { range, bucket });
  const changeRange = (event) => load(event.currentTarget.value, $analytics.bucket);
  const changeBucket = (event) => load($analytics.range, event.currentTarget.value);

  $: maxModelCost = maximumCost($analytics.models);
  $: modelColors = new Map($analytics.models.map((model, index) => [model.model, CHART_COLORS[index % CHART_COLORS.length]]));
  $: chartData = makeChart($analytics.series);
  $: chartDescription = `Cost by ${$analytics.bucket}. ${chartData.map((item) => chartTitle(item, $analytics.bucket).replaceAll("\n", ", ")).join("; ")}`;
  $: maxChartCost = maximumCost(chartData);
  $: chartLabelEvery = Math.max(1, Math.ceil(chartData.length / 6));
  $: chartColor = (model) => modelColors.get(model) ?? CHART_COLORS[0];
</script>

<div class="analytics-controls">
  <label>Range
    <select value={$analytics.range} disabled={$analytics.loading} onchange={changeRange}>
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d">Last 90 days</option>
      <option value="all">All time</option>
    </select>
  </label>
  <label>Group by
    <select value={$analytics.bucket} disabled={$analytics.loading} onchange={changeBucket}>
      <option value="hour">Hour</option>
      <option value="day">Day</option>
    </select>
  </label>
  <button type="button" class="chip" disabled={$analytics.loading} onclick={() => load()}>Refresh</button>
</div>

{#if $analytics.loading}
  <div class="m-path" role="status"><span class="spin" aria-hidden="true"></span> aggregating SQLite usage…</div>
{:else if $analytics.error}
  <div class="analytics-error" role="alert">{$analytics.error}</div>
{:else}
  <div class="analytics-summary">
    <div><strong>{money($analytics.total.cost)}</strong><span>cost</span></div>
    <div><strong>{formatNumber($analytics.total.requests)}</strong><span>responses</span></div>
    <div><strong>{formatNumber($analytics.total.input)}</strong><span>input tokens</span></div>
    <div><strong>{formatNumber($analytics.total.output)}</strong><span>output tokens</span></div>
    <div><strong>{formatNumber($analytics.total.cacheRead)}</strong><span>cache read</span></div>
    <div><strong>{formatNumber($analytics.total.reasoning)}</strong><span>reasoning</span></div>
  </div>

  <h3 class="analytics-heading">By model</h3>
  {#if !$analytics.models.length}
    <div class="m-path" role="status">No usage in this range.</div>
  {:else}
    <div class="analytics-models">
      {#each $analytics.models as model (model.model)}
        <div class="analytics-model-row">
          <div class="analytics-model-name" title={model.model}>{model.model}</div>
          <div class="analytics-bar" aria-hidden="true"><i style:width={modelBarWidth(model)}></i></div>
          <span>{money(model.cost)}</span><span>{formatNumber(model.totalTokens)} tok</span><span>{formatNumber(model.requests)} calls</span>
        </div>
      {/each}
    </div>
  {/if}

  <h3 class="analytics-heading">Cost over time</h3>
  {#if chartData.length}
    <div class="analytics-chart" role="img" aria-label={chartDescription}>
      <div class="analytics-chart-scale"><span>{money(maxChartCost)}</span><span>$0</span></div>
      <div class="analytics-chart-scroll">
        <div class="analytics-chart-bars">
          {#each chartData as item, index (item.bucket)}
            <div class="analytics-chart-column" title={chartTitle(item, $analytics.bucket)}>
              <div class="analytics-chart-bar" style:height={chartBarHeight(item)}>
                {#each item.rows as row (row.model)}
                  <i style:flex-basis={chartSegmentBasis(row, item)} style:background={chartColor(row.model)}></i>
                {/each}
              </div>
              <time datetime={item.bucket} class:visible={chartLabelVisible(index)}>{bucketLabel(item.bucket, $analytics.bucket)}</time>
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="analytics-chart-legend">
      {#each $analytics.models as model (model.model)}
        <span><i style:background={chartColor(model.model)}></i>{model.model}</span>
      {/each}
    </div>
  {:else}
    <div class="m-path" role="status">No cost data in this range.</div>
  {/if}
{/if}

<div class="m-actions" id="mActions">
  <button type="button" class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
