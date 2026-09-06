import { createHeadlessDriver } from "./headless-driver.mjs";

/** Amp adapter using its Claude-compatible streaming JSON input/output protocol. */
export function createAmpDriver(options = {}) {
  return createHeadlessDriver({
    id: "amp", label: "Amp", kind: "amp", provider: "amp",
    ...options,
  });
}
