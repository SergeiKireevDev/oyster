import { createConnectionCoordinator } from "./connectionCoordinator.js";

/** Builds the platform transport boundary from injected transport adapters. */
export function createPlatformConnection({ connect, disconnect, refreshState, dispatch }) {
  return createConnectionCoordinator({ connect, disconnect, refreshState, dispatch });
}
