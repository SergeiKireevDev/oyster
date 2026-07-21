import { API_KEYS_OPEN_ACTION } from "../../runtime/uiActionNames.js";
import { createApiKeysController } from "./createApiKeysController.js";

/** Owns the mount-scoped API-key workflow independently of settings. */
export function createCredentialsAssembly({
  uiActions,
  openModal,
  fetchImpl,
  confirm,
  toast,
  setState,
  createController = createApiKeysController,
} = {}) {
  if (!uiActions) throw new TypeError("uiActions is required");
  if (typeof openModal !== "function") throw new TypeError("openModal is required");
  let tornDown = false;
  const controller = createController({ fetchImpl, confirm, toast, setState });

  const open = () => {
    if (tornDown) return;
    openModal({ title: "API Keys", wide: true, content: "apiKeys" });
    return controller.load();
  };
  const detachOpenAction = uiActions.register(API_KEYS_OPEN_ACTION, open);

  return Object.freeze({
    operations: Object.freeze({ open, load: controller.load, save: controller.save, remove: controller.remove }),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      detachOpenAction();
      controller.teardown();
    },
  });
}
