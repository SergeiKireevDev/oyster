import { createHublotFeature } from "./createHublotFeature.js";
import { createHublotManagerController } from "../../lib/hublotManagerController.js";
import { refreshHublotScope } from "../../lib/hublotActions.js";
import { createHublotController } from "../../lib/hublotController.js";

export function createHublotRuntime(deps) {
  let scopeAll = false;
  const form = { desc: "" };
  const visible = (tunnel) => deps.isVisible(tunnel, scopeAll, deps.getSessionId());
  let controller;
  const refresh = (options) => controller.refresh(options);
  const manager = createHublotManagerController({ resetCarousel: deps.resetCarousel, openModal: deps.openModal, refresh, getScopeAll: () => scopeAll });
  controller = createHublotFeature({ createController: deps.createController ?? createHublotController, dependencies: {
    ...deps, getSessionId: deps.getSessionId, setDescription: (desc) => { form.desc = desc; deps.setDescription(desc); },
    listSidebarHublots: () => deps.listSidebarHublots(visible), isVisible: visible,
    getScopeAll: () => scopeAll, getDescription: () => form.desc,
  }});
  const toggleScope = () => refreshHublotScope({ scopeAll, setScope: (value) => { scopeAll = value; }, updateTitle: deps.updateTitle, refreshManager: () => refresh({ loading: true }), refreshSidebar: controller.refreshSidebar, refreshRoutines: deps.refreshRoutines });
  return {
    controller,
    show: manager.show,
    create: controller.create,
    toggleScope,
    refresh,
    load: controller.refreshSidebar,
    getScopeAll: () => scopeAll,
    isVisible: visible,
    teardown: () => controller.teardown?.(),
  };
}
