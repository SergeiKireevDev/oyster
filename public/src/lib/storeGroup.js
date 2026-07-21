import { get } from "svelte/store";

/**
 * Subscribe to a dynamic group of Svelte stores and publish an immutable
 * snapshot whenever any member changes. The returned cleanup owns every
 * subscription, making it safe to use directly from a Svelte effect.
 */
export function subscribeStoreGroup(stores, publish) {
  const values = stores.map((store) => get(store));
  publish([...values]);
  const unsubscribers = stores.map((store, index) => store.subscribe((value) => {
    values[index] = value;
    publish([...values]);
  }));
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
