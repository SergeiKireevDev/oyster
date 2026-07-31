/**
 * Report an action's DOM node without using a reactive effect. Svelte owns the
 * action lifecycle and calls update when the callback prop changes.
 */
export function reportNode(node, callback) {
  callback(node);

  return {
    update(nextCallback) {
      callback = nextCallback;
      callback(node);
    },
  };
}
