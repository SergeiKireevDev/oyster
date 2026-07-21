/** Creates an instance-scoped registry for component-to-runtime UI actions. */
export function createUiActionRegistry() {
  const actions = new Map();
  let disposed = false;

  return Object.freeze({
    register(name, handler) {
      if (typeof name !== "string" || !name) throw new TypeError("action name must be a non-empty string");
      if (typeof handler !== "function") throw new TypeError("action handler must be a function");
      if (disposed) return () => {};

      actions.set(name, handler);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        if (actions.get(name) === handler) actions.delete(name);
      };
    },

    invoke(name, ...args) {
      if (disposed) return undefined;
      return actions.get(name)?.(...args);
    },

    teardown() {
      if (disposed) return;
      disposed = true;
      actions.clear();
    },
  });
}
