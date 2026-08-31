import {
  TUTORIAL_DISMISS_ACTION,
  TUTORIAL_NEXT_ACTION,
  TUTORIAL_OPEN_ACTION,
  TUTORIAL_PREVIOUS_ACTION,
} from "../../runtime/uiActionNames.js";
import { createTutorialController } from "./createTutorialController.js";

export function createTutorialAssembly({
  uiActions,
  storage,
  setState,
  isMobile,
  createController = createTutorialController,
} = {}) {
  if (!uiActions) throw new TypeError("uiActions is required");

  let tornDown = false;
  const controller = createController({ storage, setState, isMobile });
  const registrations = [
    [TUTORIAL_OPEN_ACTION, controller.open],
    [TUTORIAL_NEXT_ACTION, controller.next],
    [TUTORIAL_PREVIOUS_ACTION, controller.previous],
    [TUTORIAL_DISMISS_ACTION, controller.finish],
  ].map(([name, handler]) => uiActions.register(name, handler));

  return Object.freeze({
    operations: Object.freeze({
      initialize: controller.initialize,
      open: controller.open,
      next: controller.next,
      previous: controller.previous,
      dismiss: controller.finish,
    }),
    teardown() {
      if (tornDown) return;
      tornDown = true;
      for (const detach of registrations.reverse()) detach();
      controller.teardown();
    },
  });
}
