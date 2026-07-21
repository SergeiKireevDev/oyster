/** Narrow lifecycle boundary for transport connection ownership. */
export function createConnectionCoordinator({ connect, disconnect, refreshState, dispatch }) {
  let active = true;
  return {
    connect: (...args) => active ? connect(...args) : undefined,
    disconnect: (...args) => disconnect(...args),
    refreshState: (...args) => active ? refreshState(...args) : undefined,
    dispatch: (...args) => active ? dispatch(...args) : undefined,
    teardown: () => { active = false; disconnect(); },
  };
}
