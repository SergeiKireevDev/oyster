import { TUTORIAL_STEPS } from "./tutorialSteps.js";

export const TUTORIAL_DESKTOP_COMPLETION_KEY = "oyster_tutorial_v1_complete_desktop";
export const TUTORIAL_MOBILE_COMPLETION_KEY = "oyster_tutorial_v1_complete_mobile";

export function createTutorialController({ storage, setState, isMobile = () => false } = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("storage is required");
  }
  if (typeof setState !== "function") throw new TypeError("setState is required");
  if (typeof isMobile !== "function") throw new TypeError("isMobile is required");

  let initialized = false;
  let active = false;
  let activeCompletionKey = null;
  let stepIndex = 0;
  let tornDown = false;

  function publish(patch) {
    if (!tornDown) setState(patch);
  }

  function completionKey() {
    return isMobile() ? TUTORIAL_MOBILE_COMPLETION_KEY : TUTORIAL_DESKTOP_COMPLETION_KEY;
  }

  function completed(key) {
    try {
      return storage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function rememberCompletion() {
    try {
      storage.setItem(activeCompletionKey ?? completionKey(), "1");
    } catch {
      // A private or restricted browser may reject persistence. Dismiss anyway.
    }
  }

  function open() {
    if (tornDown) return false;
    active = true;
    activeCompletionKey = completionKey();
    stepIndex = 0;
    publish({ active: true, stepIndex });
    return true;
  }

  function initialize() {
    if (tornDown || initialized) return false;
    initialized = true;
    const key = completionKey();
    if (completed(key)) return false;
    activeCompletionKey = key;
    return open();
  }

  function finish() {
    if (tornDown || !active) return false;
    rememberCompletion();
    active = false;
    activeCompletionKey = null;
    publish({ active: false, stepIndex: 0 });
    return true;
  }

  function next() {
    if (tornDown || !active) return false;
    if (stepIndex >= TUTORIAL_STEPS.length - 1) return finish();
    stepIndex += 1;
    publish({ stepIndex });
    return true;
  }

  function previous() {
    if (tornDown || !active || stepIndex === 0) return false;
    stepIndex -= 1;
    publish({ stepIndex });
    return true;
  }

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    active = false;
    activeCompletionKey = null;
    stepIndex = 0;
    setState({ active: false, stepIndex: 0 });
  }

  return Object.freeze({ initialize, open, next, previous, finish, teardown });
}
