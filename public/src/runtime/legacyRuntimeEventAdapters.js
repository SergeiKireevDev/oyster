/** Register the remaining feature event adapters once and expose explicit teardown. */
export function createLegacyRuntimeEventAdapters({ attachers, applyCarousel }) {
  let attached = false;

  return {
    attach() {
      if (attached) return;
      attached = true;
      attachers.forEach((adapter) => adapter.attach());
      applyCarousel();
    },
  };
}
