import { loadLegacyRuntimeLifecycle } from "./legacyRuntimeAdapter.js";

/** Temporary composition root while feature dependencies leave legacy.js. */
export async function startAppRuntime() {
  const runtime = await loadLegacyRuntimeLifecycle();
  runtime.start();
  return runtime.teardown;
}
