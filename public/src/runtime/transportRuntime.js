import {
  clearAuthToken,
  createAuthProbe,
  createUnauthorizedHandler,
  initializeAuth,
  showAuthGate,
} from "./authClient.js";
import { createRpcClient } from "./rpcClient.js";

/** Constructs transport state with browser and UI behavior supplied explicitly. */
export function createTransportRuntime({
  browser,
  gate,
  getRunner,
  onInvalidToken,
  toast,
}) {
  const token = initializeAuth();
  const requireToken = () => showAuthGate({ gate, input: browser.document.getElementById("gateInput") });
  const handleUnauthorized = createUnauthorizedHandler({
    storage: browser.storage,
    documentTarget: browser.document,
    requireToken,
    toast,
  });
  const probeTokenValidity = createAuthProbe({
    getToken: () => token,
    onUnauthorized: () => {
      clearAuthToken({ storage: browser.storage, documentTarget: browser.document });
      onInvalidToken();
      requireToken();
    },
  });
  const rpcClient = createRpcClient({
    getRunner,
    getToken: () => token,
    onUnauthorized: handleUnauthorized,
    onPendingResume: () => toast("session is still resuming — message queued", "warning"),
  });

  return { token, requireToken, handleUnauthorized, probeTokenValidity, ...rpcClient };
}
