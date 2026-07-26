import { createCompositeWorkspaceDriver } from "./composite.mjs";
import { createLlmboxDriver } from "./llmbox.mjs";
import { createMockWorkspaceDriver } from "./mock.mjs";

const factories = new Map([
  ["llmbox", createLlmboxDriver],
  ["mock", createMockWorkspaceDriver],
]);

export function createWorkspaceDriver(config, options = {}) {
  if (config.type === "composite") {
    const drivers = config.drivers.map((child, index) => createWorkspaceDriver(child, {
      ...options,
      binding: options.bindings?.[index] || null,
      bindings: undefined,
    }));
    return createCompositeWorkspaceDriver(config, { drivers });
  }
  const factory = factories.get(config.type);
  if (!factory) throw new Error(`unsupported workspace driver: ${config.type}`);
  return factory(config, options);
}

export const workspaceDriverTypes = Object.freeze([...factories.keys()]);
