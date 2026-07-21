import {
  CREDENTIALS_CANCEL_OAUTH_ACTION, CREDENTIALS_CLOSE_ACTION, CREDENTIALS_LOGOUT_OAUTH_ACTION,
  CREDENTIALS_OPEN_ACTION, CREDENTIALS_REMOVE_API_KEY_ACTION, CREDENTIALS_RESPOND_OAUTH_ACTION,
  CREDENTIALS_SAVE_API_KEY_ACTION, CREDENTIALS_START_OAUTH_ACTION,
} from "../../runtime/uiActionNames.js";
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
    controller.activate();
    openModal({ title: "Credentials", wide: true, content: "credentials" });
    return controller.load();
  };
  const registrations = [
    [CREDENTIALS_OPEN_ACTION, open],
    [CREDENTIALS_CLOSE_ACTION, controller.deactivate],
    [CREDENTIALS_SAVE_API_KEY_ACTION, controller.save],
    [CREDENTIALS_REMOVE_API_KEY_ACTION, controller.remove],
    [CREDENTIALS_START_OAUTH_ACTION, controller.startOAuth],
    [CREDENTIALS_RESPOND_OAUTH_ACTION, controller.respondOAuth],
    [CREDENTIALS_CANCEL_OAUTH_ACTION, controller.cancelOAuth],
    [CREDENTIALS_LOGOUT_OAUTH_ACTION, controller.logoutOAuth],
  ].map(([name, handler]) => uiActions.register(name, handler));

  return Object.freeze({
    operations: Object.freeze({
      open, load: controller.load, save: controller.save, remove: controller.remove,
      startOAuth: controller.startOAuth, respondOAuth: controller.respondOAuth,
      cancelOAuth: controller.cancelOAuth, logoutOAuth: controller.logoutOAuth,
    }),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      for (const detach of registrations.reverse()) detach();
      controller.teardown();
    },
  });
}
