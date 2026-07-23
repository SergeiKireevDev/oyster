import { createLlmboxDriver } from "./llmbox.mjs";
import { createMockWorkspaceDriver } from "./mock.mjs";

const factories = new Map([
  ["llmbox", createLlmboxDriver],
  ["mock", createMockWorkspaceDriver],
]);

export function createWorkspaceDriver(config, options = {}) {
  const factory = factories.get(config.type);
  if (!factory) throw new Error(`unsupported workspace driver: ${config.type}`);
  return factory(config, options);
}

export const workspaceDriverTypes = Object.freeze([...factories.keys()]);
