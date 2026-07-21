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
  isModalOpen = () => false,
  createController = createCredentialsController,
} = {}) {
  if (!uiActions) throw new TypeError("uiActions is required");
  if (typeof openModal !== "function") throw new TypeError("openModal is required");
  let tornDown = false;
  let startupChecked = false;
  const controller = createController({ fetchImpl, confirm, toast, setState });

  const open = () => {
    if (tornDown) return;
    setState({ setupMode: false });
    controller.activate();
    openModal({ title: "Credentials", wide: true, content: "credentials" });
    return controller.load();
  };
  const startOAuth = async (provider) => {
    const result = await controller.startOAuth(provider);
    if (result?.ok && !tornDown) {
      setState({ setupMode: false });
      controller.activate();
      openModal({ title: "Credentials", wide: true, content: "credentials" });
    }
    return result;
  };
  const initialize = async () => {
    if (tornDown || startupChecked) return false;
    startupChecked = true;
    const providers = await controller.load({ quiet: true });
    if (tornDown || providers.some((provider) => provider.credentialType) || isModalOpen()) return false;
    setState({ setupMode: true });
    controller.activate();
    openModal({ title: "Set up credentials", wide: true, content: "credentials" });
    return true;
  };
  const registrations = [
    [CREDENTIALS_OPEN_ACTION, open],
    [CREDENTIALS_CLOSE_ACTION, controller.deactivate],
    [CREDENTIALS_SAVE_API_KEY_ACTION, controller.save],
    [CREDENTIALS_REMOVE_API_KEY_ACTION, controller.remove],
    [CREDENTIALS_START_OAUTH_ACTION, startOAuth],
    [CREDENTIALS_RESPOND_OAUTH_ACTION, controller.respondOAuth],
    [CREDENTIALS_CANCEL_OAUTH_ACTION, controller.cancelOAuth],
    [CREDENTIALS_LOGOUT_OAUTH_ACTION, controller.logoutOAuth],
  ].map(([name, handler]) => uiActions.register(name, handler));

  return Object.freeze({
    operations: Object.freeze({
      open, initialize, load: controller.load, save: controller.save, remove: controller.remove,
      startOAuth, respondOAuth: controller.respondOAuth,
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
