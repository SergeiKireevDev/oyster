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
  const token = initializeAuth({
    locationTarget: browser.location,
    historyTarget: browser.history,
    storage: browser.storage,
    documentTarget: browser.document,
  });
  const requireToken = () => showAuthGate({ gate, input: browser.document.getElementById("gateInput") });
  const handleUnauthorized = createUnauthorizedHandler({
    storage: browser.storage,
    documentTarget: browser.document,
    requireToken,
    toast,
  });
  const invalidateToken = () => {
    clearAuthToken({ storage: browser.storage, documentTarget: browser.document });
    onInvalidToken();
  };
  const validateToken = async () => {
    try {
      const response = await browser.fetch("/authcheck");
      if (!response.ok) return false;
      const report = await response.json();
      if (report.authorized === true) return true;
      invalidateToken();
    } catch {}
    return false;
  };
  const probeTokenValidity = createAuthProbe({
    fetchImpl: browser.fetch,
    getToken: () => token,
    onUnauthorized: () => {
      invalidateToken();
      requireToken();
    },
  });
  const rpcClient = createRpcClient({
    getRunner,
    getToken: () => token,
    onUnauthorized: handleUnauthorized,
    onPendingResume: () => toast("session is still resuming — message queued", "warning"),
  });

  return { token, validateToken, requireToken, handleUnauthorized, probeTokenValidity, ...rpcClient };
}
