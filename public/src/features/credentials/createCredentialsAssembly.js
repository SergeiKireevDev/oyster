import { CREDENTIALS_OPEN_ACTION, CREDENTIALS_REMOVE_API_KEY_ACTION, CREDENTIALS_SAVE_API_KEY_ACTION } from "../../runtime/uiActionNames.js";
import { createCredentialsController } from "./createCredentialsController.js";

/** Owns the mount-scoped API-key workflow independently of settings. */
export function createCredentialsAssembly({
  uiActions,
  openModal,
  fetchImpl,
  confirm,
  toast,
  setState,
  createController = createCredentialsController,
} = {}) {
  if (!uiActions) throw new TypeError("uiActions is required");
  if (typeof openModal !== "function") throw new TypeError("openModal is required");
  let tornDown = false;
  const controller = createController({ fetchImpl, confirm, toast, setState });

  const open = () => {
    if (tornDown) return;
    openModal({ title: "Credentials", wide: true, content: "credentials" });
    return controller.load();
  };
  const detachOpenAction = uiActions.register(CREDENTIALS_OPEN_ACTION, open);
  const detachSaveAction = uiActions.register(CREDENTIALS_SAVE_API_KEY_ACTION, controller.save);
  const detachRemoveAction = uiActions.register(CREDENTIALS_REMOVE_API_KEY_ACTION, controller.remove);

  return Object.freeze({
    operations: Object.freeze({ open, load: controller.load, save: controller.save, remove: controller.remove }),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      detachRemoveAction();
      detachSaveAction();
      detachOpenAction();
      controller.teardown();
    },
  });
}
