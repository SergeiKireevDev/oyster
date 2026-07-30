const REQUIRED_REPOSITORIES = Object.freeze({
  checkpoints: "listForSession",
  hublots: "list",
  operations: "listIncomplete",
  pinnedWidgets: "list",
  routines: "list",
  runnerEvents: "list",
  runners: "list",
  sessions: "find",
});

const REQUIRED_CATALOG_METHODS = Object.freeze([
  "entries", "findById", "folders", "list", "messages", "readHeader", "search", "summarize", "tree",
]);

const CANDIDATE_STATE_FIELDS = new Set([
  "piProcesses",
  "runnerReaperTimer",
  "runnerWatchdogTimer",
  "sessionCatalog",
  "sessionCatalogKey",
  "sessionOperations",
  "sessionReferences",
]);

/**
 * Give a candidate private storage for generation-owned fields while retaining
 * access to stable-core state. Writes to durable/stable fields still reach the
 * stable object; candidate-owned writes can never replace the active values.
 */
export function createCandidateState(stableState) {
  const candidateFields = Object.fromEntries([...CANDIDATE_STATE_FIELDS].map((field) => [field, undefined]));
  return new Proxy(stableState, {
    get(target, property, receiver) {
      if (CANDIDATE_STATE_FIELDS.has(property)) return candidateFields[property];
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (CANDIDATE_STATE_FIELDS.has(property)) {
        candidateFields[property] = value;
        return true;
      }
      return Reflect.set(target, property, value, target);
    },
    deleteProperty(target, property) {
      if (CANDIDATE_STATE_FIELDS.has(property)) return delete candidateFields[property];
      return Reflect.deleteProperty(target, property);
    },
  });
}

/** Verify the stable application store is complete and its connection is readable. */
export function validateRepositoryAvailability(appStore) {
  if (!appStore?.repositories || typeof appStore.hydrate !== "function") {
    throw new Error("stable core did not provide a readable application store");
  }
  for (const [name, probe] of Object.entries(REQUIRED_REPOSITORIES)) {
    const repository = appStore.repositories[name];
    if (!repository || typeof repository[probe] !== "function") {
      throw new Error(`application repository "${name}" is unavailable (missing ${probe}())`);
    }
  }
  try {
    return appStore.hydrate();
  } catch (cause) {
    throw new Error("application repository access failed", { cause });
  }
}

/** Verify the selected session catalog contract and perform one read probe. */
export function validateCatalogAccess(catalog, { backend, cwd } = {}) {
  if (!catalog || catalog.backend !== backend) {
    throw new Error(`session catalog backend mismatch: expected "${backend}"`);
  }
  for (const method of REQUIRED_CATALOG_METHODS) {
    if (typeof catalog[method] !== "function") throw new Error(`session catalog is missing ${method}()`);
  }
  let sessions;
  try {
    sessions = catalog.list({ cwd });
  } catch (cause) {
    throw new Error(`cannot read ${backend} session catalog`, { cause });
  }
  if (!Array.isArray(sessions)) throw new Error("session catalog list() must return an array");
  return sessions;
}

/** Assert that factories produced the callable boundaries composition needs. */
export function validateDependencyConstruction(dependencies) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency?.value) throw new Error(`dependency "${name}" was not constructed`);
    for (const method of dependency.methods ?? []) {
      if (typeof dependency.value[method] !== "function") {
        throw new Error(`dependency "${name}" is missing ${method}()`);
      }
    }
  }
}

/**
 * An idempotent LIFO cleanup stack and generation token for staged resources.
 * Guarded callbacks become inert synchronously when disposal starts. This is
 * required even when clearInterval/removeListener succeeds: a callback may
 * already be queued in the event loop at that point.
 */
export function createDisposableScope({ generation = Symbol("application-candidate") } = {}) {
  const cleanups = [];
  let disposal = null;
  let started = false;

  function guard(callback) {
    if (typeof callback !== "function") throw new TypeError("guarded callback must be a function");
    const guarded = function (...args) {
      if (started) return undefined;
      return callback.apply(this, args);
    };
    Object.defineProperty(guarded, "generation", { value: generation, enumerable: true });
    return guarded;
  }

  function listen(target, event, callback) {
    if (started) throw new Error("cannot acquire a resource after candidate disposal started");
    const guarded = guard(callback);
    if (typeof target?.addEventListener === "function") {
      target.addEventListener(event, guarded);
      cleanups.push(() => target.removeEventListener(event, guarded));
    } else if (typeof target?.on === "function" && typeof target?.off === "function") {
      target.on(event, guarded);
      cleanups.push(() => target.off(event, guarded));
    } else {
      throw new TypeError("listener target must support add/removeEventListener or on/off");
    }
    return guarded;
  }

  return {
    generation,
    guard,
    listen,
    get active() { return !started; },
    defer(cleanup) {
      if (started) throw new Error("cannot acquire a resource after candidate disposal started");
      cleanups.push(cleanup);
    },
    dispose() {
      // Invalidate first, before an asynchronous cleanup can yield and allow a
      // queued timer or event callback from this generation to run.
      started = true;
      if (!disposal) {
        disposal = (async () => {
          const errors = [];
          // Successful cleanups are removed permanently. Failed cleanups stay
          // pending so stable-core retirement can make a bounded retry.
          for (let index = cleanups.length - 1; index >= 0; index--) {
            try {
              await cleanups[index]();
              cleanups.splice(index, 1);
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length) throw new AggregateError(errors, "candidate disposal failed");
        })().catch((error) => {
          disposal = null;
          throw error;
        });
      }
      return disposal;
    },
  };
}

/**
 * Admit each request synchronously and defer resource disposal until every
 * request admitted by this generation has left its handler.
 */
export function createRequestLifecycle() {
  let accepting = true;
  let entered = 0;
  let drained = null;
  let resolveDrained = null;

  const waitForDrain = () => {
    if (entered === 0) return Promise.resolve();
    if (!drained) drained = new Promise((resolve) => { resolveDrained = resolve; });
    return drained;
  };

  return {
    handle(handler, args) {
      if (!accepting) throw new Error("candidate application is retired");
      entered++;
      return Promise.resolve()
        .then(() => handler(...args))
        .finally(() => {
          entered--;
          if (entered === 0) resolveDrained?.();
        });
    },
    retire() {
      accepting = false;
      return waitForDrain();
    },
  };
}
