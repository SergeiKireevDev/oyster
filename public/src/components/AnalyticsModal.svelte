<script>
  import { analytics } from "../stores/analytics.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { ANALYTICS_LOAD_ACTION } from "../runtime/uiActionNames.js";

  const CHART_COLORS = [
    "var(--analytics-series-1)",
    "var(--analytics-series-2)",
    "var(--analytics-series-3)",
    "var(--analytics-series-4)",
    "var(--analytics-series-5)",
    "var(--analytics-series-6)",
    "var(--analytics-series-7)",
    "var(--analytics-series-8)",
  ];
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

<div class="analytics-modal" aria-busy={$analytics.loading}>
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
    <button type="button" class="chip" disabled={$analytics.loading} onclick={() => load()}>
      {#if $analytics.loading}<span class="spin" aria-hidden="true"></span>{/if}
      {$analytics.loading ? "Refreshing…" : "Refresh"}
    </button>
  </div>

  {#if $analytics.loading}
    <div class="m-path analytics-state" role="status" aria-live="polite" aria-atomic="true"><span class="spin" aria-hidden="true"></span> aggregating SQLite usage…</div>
  {:else if $analytics.error}
    <div class="analytics-error" role="alert"><strong>Couldn’t load usage</strong><span>{$analytics.error}</span></div>
  {:else}
    <dl class="analytics-summary" aria-label="Usage totals">
      <div><dt>Cost</dt><dd>{money($analytics.total.cost)}</dd></div>
      <div><dt>Responses</dt><dd>{formatNumber($analytics.total.requests)}</dd></div>
      <div><dt>Input tokens</dt><dd>{formatNumber($analytics.total.input)}</dd></div>
      <div><dt>Output tokens</dt><dd>{formatNumber($analytics.total.output)}</dd></div>
      <div><dt>Cache read</dt><dd>{formatNumber($analytics.total.cacheRead)}</dd></div>
      <div><dt>Reasoning</dt><dd>{formatNumber($analytics.total.reasoning)}</dd></div>
    </dl>

    <h3 class="analytics-heading">By model</h3>
    {#if !$analytics.models.length}
      <div class="m-path analytics-empty" role="status">No usage in this range.</div>
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
      <div class="analytics-chart-legend" aria-hidden="true">
        {#each $analytics.models as model (model.model)}
          <span title={model.model}><i style:background={chartColor(model.model)}></i>{model.model}</span>
        {/each}
      </div>
    {:else}
      <div class="m-path analytics-empty" role="status">No cost data in this range.</div>
    {/if}
  {/if}

  <div class="m-actions" id="mActions">
    <button type="button" class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
  </div>
</div>

<style>
  .analytics-modal {
    --analytics-series-1: #9da9ff;
    --analytics-series-2: #62cfaa;
    --analytics-series-3: #e8b765;
    --analytics-series-4: #e8849a;
    --analytics-series-5: #ad91e8;
    --analytics-series-6: #68afe0;
    --analytics-series-7: #9abc62;
    --analytics-series-8: #d98568;
    min-width: 0;
  }

  .analytics-controls {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
  }
  .analytics-controls label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }
  .analytics-controls select {
    min-width: 138px;
    min-height: 36px;
    padding: 6px 28px 6px 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: border-color .15s, background .15s, opacity .15s;
  }
  .analytics-controls select:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .analytics-controls select:disabled, .analytics-controls > button:disabled { cursor: default; opacity: .45; transform: none; }
  .analytics-controls > button { min-height: 36px; margin-left: auto; }

  .analytics-state { min-height: 84px; display: flex; align-items: center; justify-content: center; gap: 7px; }
  .analytics-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
  .analytics-summary > div {
    min-width: 0;
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    padding: 10px 11px;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel-2) 72%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
  }
  .analytics-summary dt { color: var(--muted); font-size: 10.5px; }
  .analytics-summary dd { margin: 0; overflow: hidden; color: var(--text); font-size: 17px; font-weight: 650; letter-spacing: -.02em; text-overflow: ellipsis; }
  .analytics-summary > div:first-child dd { color: var(--accent); }

  .analytics-heading {
    margin: 17px 0 8px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .analytics-models { display: grid; gap: 5px; }
  .analytics-model-row {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(130px, 1.4fr) minmax(70px, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 3px 6px;
    border-radius: 8px;
    color: var(--muted);
    font-size: 10.5px;
  }
  .analytics-model-row:nth-child(odd) { background: color-mix(in srgb, var(--panel-2) 52%, transparent); }
  .analytics-model-name { min-width: 0; overflow: hidden; color: var(--text); font-size: 11.5px; font-weight: 580; text-overflow: ellipsis; white-space: nowrap; }
  .analytics-bar { height: 6px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--border) 70%, transparent); }
  .analytics-bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); }

  .analytics-chart {
    height: 212px;
    display: flex;
    padding: 11px 10px 4px;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: 11px;
    background: color-mix(in srgb, var(--panel) 58%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 3%, transparent);
  }
  .analytics-chart-scale { width: 48px; height: 165px; flex: none; display: flex; flex-direction: column; justify-content: space-between; color: var(--muted); font-size: 9.5px; }
  .analytics-chart-scroll { min-width: 0; flex: 1; overflow-x: auto; overflow-y: hidden; overscroll-behavior-inline: contain; }
  .analytics-chart-bars {
    width: max-content;
    min-width: 100%;
    height: 194px;
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
    background: repeating-linear-gradient(to bottom, transparent 0, transparent 40px, color-mix(in srgb, var(--border) 45%, transparent) 41px);
  }
  .analytics-chart-column { min-width: 20px; height: 194px; flex: 1 0 20px; display: grid; grid-template-rows: 165px 29px; align-items: end; padding: 0 2px; }
  .analytics-chart-bar { width: 100%; min-height: 1px; display: flex; flex-direction: column-reverse; overflow: hidden; border-radius: 3px 3px 0 0; transition: opacity .15s; }
  .analytics-chart-bar:hover { opacity: .78; }
  .analytics-chart-bar i { display: block; min-height: 1px; }
  .analytics-chart-column time { width: 72px; align-self: center; visibility: hidden; transform: rotate(-28deg); transform-origin: center; color: var(--muted); font-size: 9px; white-space: nowrap; }
  .analytics-chart-column time.visible { visibility: visible; }
  .analytics-chart-legend { display: flex; flex-wrap: wrap; gap: 5px 10px; padding-top: 8px; color: var(--muted); font-size: 10px; }
  .analytics-chart-legend span { min-width: 0; max-width: 190px; display: flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .analytics-chart-legend i { width: 8px; height: 8px; flex: none; border-radius: 2px; }

  .analytics-empty { min-height: 48px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 10px; background: color-mix(in srgb, var(--panel-2) 35%, transparent); text-align: center; }
  .analytics-error { display: grid; gap: 3px; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--red) 42%, var(--border)); border-radius: 10px; background: color-mix(in srgb, var(--red) 8%, transparent); color: var(--red); }
  .analytics-error strong { font-size: 12px; font-weight: 650; }
  .analytics-error span { color: var(--text); font-size: 11.5px; overflow-wrap: anywhere; }

  @media (max-width: 600px) {
    .analytics-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .analytics-model-row { grid-template-columns: minmax(105px, 1fr) minmax(54px, .65fr) auto auto; }
    .analytics-model-row span:last-child { display: none; }
    .analytics-chart-scale { width: 42px; }
  }

  @media (max-width: 520px) {
    .analytics-controls { display: grid; grid-template-columns: 1fr 1fr; }
    .analytics-controls label, .analytics-controls select { min-width: 0; width: 100%; }
    .analytics-controls select, .analytics-controls > button { min-height: 40px; }
    .analytics-controls > button { grid-column: 1 / -1; width: 100%; margin-left: 0; }
    .analytics-model-row { grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
    .analytics-model-row .analytics-bar, .analytics-model-row span:last-child { display: none; }
  }
</style>
