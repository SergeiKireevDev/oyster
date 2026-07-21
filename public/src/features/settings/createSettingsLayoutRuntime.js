import { createExtensionUiController } from "../../lib/extensionUiController.js";
import { createSettingsController } from "../../lib/settingsController.js";
import { createAdjacentRunnerController } from "../../lib/sessionActions.js";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createMobileDrawerDismissController } from "../../runtime/carouselController.js";
import { createCarouselEventDependencies } from "../../runtime/carouselEventDependencies.js";
import { createLayoutFeature } from "../layout/createLayoutFeature.js";
import { createSettingsFeature } from "./createSettingsFeature.js";
import { configureHeaderActions } from "./headerActions.js";
import { configureSettingsActions } from "./settingsActions.js";

export function createSettingsLayoutRuntime(deps) {
  const settings = createSettingsFeature({
    createController: createSettingsController,
    dependencies: {
      rpc: deps.rpc,
      pickOption: deps.extensionUiAdapters.select,
      refreshState: deps.refreshState,
      toast: deps.toast,
      getState: deps.getState,
    },
  });

  const detachSettingsActions = configureSettingsActions({
    changed: () => deps.reloadTranscript().catch(() => {}),
  });

  const handleExtensionUI = createExtensionUiController({
    respond: (id, payload) => deps.rpc({ type: "extension_ui_response", id, ...payload }, { wait: false }).catch(() => {}),
    toast: deps.toast,
    ...deps.extensionUiAdapters,
  });

  const carousel = createLayoutFeature({
    createController: createCarouselController,
    dependencies: {
      documentTarget: deps.documentTarget,
      windowTarget: deps.windowTarget,
      storage: deps.storage,
      setPage: deps.setCarouselPage,
      loadHublots: deps.loadScopedResources,
      loadCheckpointTree: deps.loadCheckpointTree,
    },
  });

  const swipe = createCarouselSwipeController({
    isDesktop: () => deps.windowTarget.matchMedia("(min-width: 761px)").matches,
    step: (direction) => carousel.step(direction),
    switchRunner: createAdjacentRunnerController({
      getRunners: deps.getRunners,
      getCurrentRunner: deps.getCurrentRunner,
      getWorkdir: deps.getWorkdir,
      switchRunner: deps.switchRunner,
      toast: deps.toast,
    }),
  });

  const events = createCarouselEventRegistration(createCarouselEventDependencies({
    documentTarget: deps.documentTarget,
    windowTarget: deps.windowTarget,
    onTouchStart: swipe.onTouchStart,
    onTouchMove: swipe.onTouchMove,
    onTouchEnd: swipe.onTouchEnd,
    onTouchCancel: swipe.onTouchCancel,
    onResize: () => carousel.apply(),
  }));

  const header = createCarouselHeaderController({
    isDesktop: () => deps.windowTarget.matchMedia("(min-width: 761px)").matches,
    hublots: deps.hublotsEl,
    treebar: deps.treebarEl,
    loadHublots: deps.loadScopedResources,
    loadCheckpointTree: deps.loadCheckpointTree,
    carousel,
  });

  const mobileDrawer = createMobileDrawerDismissController({
    documentTarget: deps.documentTarget,
    windowTarget: deps.windowTarget,
    hublots: deps.hublotsEl,
    treebar: deps.treebarEl,
    getCarousel: () => carousel,
    isToggleTarget: deps.isDrawerToggleTarget,
  });

  const detachHeaderActions = configureHeaderActions((action, sourceEvent) => ({
    chooseModel: settings.chooseModel,
    cycleThinking: settings.cycleThinking,
    openConfig: settings.openConfig,
    toggleHublots: header.toggleHublots,
    toggleTree: header.toggleTree,
  })[action]?.(sourceEvent));

  const settingsOperations = Object.freeze({
    chooseModel: (...args) => settings.chooseModel(...args),
    cycleThinking: (...args) => settings.cycleThinking(...args),
    openConfig: (...args) => settings.openConfig(...args),
  });
  const layoutOperations = Object.freeze({
    apply: (...args) => carousel.apply(...args),
    reset: (...args) => carousel.reset(...args),
  });
  let attached = false;
  let tornDown = false;
  const eventAdapter = Object.freeze({
    attach() {
      if (attached || tornDown) return;
      attached = true;
      events.attach();
      mobileDrawer.attach();
    },
    detach() {
      if (!attached) return;
      attached = false;
      events.detach();
      mobileDrawer.detach();
    },
  });
  return {
    settings: settingsOperations,
    layout: layoutOperations,
    handleExtensionUI,
    attach: eventAdapter.attach,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      eventAdapter.detach();
      detachHeaderActions();
      detachSettingsActions();
      settings.teardown?.();
      carousel.teardown?.();
    },
  };
}
