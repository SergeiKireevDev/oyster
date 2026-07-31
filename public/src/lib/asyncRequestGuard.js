/**
 * Guards state updates made after asynchronous work. Starting a request makes
 * older tokens stale; invalidating the guard also prevents completion after
 * its lifecycle owner has been destroyed.
 */
export function createAsyncRequestGuard() {
  let generation = 0;
  let active = true;

  return Object.freeze({
    begin() {
      const requestGeneration = ++generation;
      return Object.freeze({
        isCurrent: () => active && requestGeneration === generation,
      });
    },
    invalidate() {
      active = false;
      generation += 1;
    },
  });
}
