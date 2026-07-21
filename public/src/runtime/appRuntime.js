import { createLegacyRuntimeLifecycle } from "./legacyRuntimeLifecycle.js";

/** Temporary composition root while feature dependencies leave legacy.js. */
export async function startAppRuntime() {
  const { createLegacyRuntimeLifecycleDependencies } = await import("../legacy.js");
  const runtime = createLegacyRuntimeLifecycle(createLegacyRuntimeLifecycleDependencies());
  runtime.start();
  return runtime.teardown;
}
