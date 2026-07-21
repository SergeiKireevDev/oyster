import { createLegacyRuntimeLifecycle } from "./legacyRuntimeLifecycle.js";

export async function loadLegacyRuntimeLifecycle() {
  const { createLegacyRuntimeLifecycleDependencies } = await import("../legacy.js");
  return createLegacyRuntimeLifecycle(createLegacyRuntimeLifecycleDependencies());
}
