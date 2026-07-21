/** Narrow lifecycle boundary for transport connection ownership. */
export function createConnectionCoordinator({ connect, disconnect, refreshState, dispatch }) {
  return { connect, disconnect, refreshState, dispatch };
}
