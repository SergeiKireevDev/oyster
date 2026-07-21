import { API_KEYS_OPEN_ACTION } from "../../runtime/uiActionNames.js";

/** Owns the mount-scoped API-key menu action independently of settings. */
export function createCredentialsAssembly({ uiActions, openModal } = {}) {
  if (!uiActions) throw new TypeError("uiActions is required");
  if (typeof openModal !== "function") throw new TypeError("openModal is required");
  let tornDown = false;

  const open = () => {
    if (tornDown) return;
    openModal({ title: "API Keys", wide: true, content: "apiKeys" });
  };
  const detachOpenAction = uiActions.register(API_KEYS_OPEN_ACTION, open);

  return Object.freeze({
    operations: Object.freeze({ open }),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      detachOpenAction();
    },
  });
}
