import { writable } from "svelte/store";

export const analytics = writable({
  loading: false,
  error: "",
  range: "7d",
  bucket: "day",
  generatedAt: null,
  total: { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 },
  models: [],
  series: [],
});

export function updateAnalytics(patch) {
  analytics.update((state) => ({ ...state, ...patch }));
}
