import { createCommandGuard, commandTrigger, filterCommands } from "../../lib/commandActions.js";
import { commandPalettePosition, commandPaletteView, createCommandPaletteInputController, createCommandPaletteKeyboardController, moveCommandPaletteActive, pathPaletteView } from "../../lib/commandController.js";
import { createComposerHistoryController } from "../../lib/composerHistoryController.js";
import { pathCompletionItems, pathCompletionRequest, pathTrigger } from "../../lib/pathAutocomplete.js";
import { promptCommand } from "../../lib/promptActions.js";
import { insertionAtCaret, insertionReplacing } from "../../lib/textInsertion.js";
import {
  COMMAND_PALETTE_RUN_ACTION,
  COMPOSER_ABORT_ACTION,
  COMPOSER_INPUT_ACTION,
  COMPOSER_KEYDOWN_ACTION,
  COMPOSER_SEND_ACTION,
  MENU_ACTION,
} from "../../runtime/uiActionNames.js";

/** Owns composer input, prompt history, send/abort, and local-echo coordination. */
export function createComposerAssembly(deps) {
  const input = deps.findElement("input");
  let commandRuntime = null;

  function resizeInput() {
    input.style.height = "auto";
    const contentHeight = input.scrollHeight;
    input.style.height = Math.min(contentHeight, 200) + "px";
    input.style.overflowY = contentHeight > 200 ? "auto" : "hidden";
  }

  function setText(text) {
    input.value = text;
    deps.setTextValue(text);
    input.setSelectionRange(text.length, text.length);
    resizeInput();
  }

  const history = createComposerHistoryController({
    getValue: () => input.value,
    getSelection: () => ({ start: input.selectionStart, end: input.selectionEnd }),
    setValue: setText,
  });

  function inputChanged() {
    resizeInput();
    deps.setTextValue(input.value);
    deps.setBusy(deps.getBusy());
    history.reset();
  }

  function insertText(text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const padAfter = after && !/^\s/.test(after) ? " " : "";
    input.value = before + pad + text + padAfter + after;
    const position = (before + pad + text).length;
    input.setSelectionRange(position, position);
    input.dispatchEvent(new Event("input"));
    input.focus();
  }

  const promptRpcCommand = (text) => promptCommand(text, deps.getBusy());

  async function send() {
    const text = input.value.trim();
    if (!text || !deps.composerReadyForSend()) return;
    const confirmKnownCommand = commandRuntime?.guard.confirmKnownCommand ?? deps.confirmKnownCommand ?? (async () => true);
    if (!await confirmKnownCommand(text)) return;
    input.value = "";
    deps.setTextValue("");
    input.style.height = "auto";
    input.style.overflowY = "hidden";
    deps.setBusy(deps.getBusy());
    deps.addUserMessage({ role: "user", content: text });
    deps.addLocalEcho(text);
    try {
      await deps.rpc(promptRpcCommand(text), { wait: false });
      deps.schedulePostSendSync(text);
    } catch (error) {
      deps.removeLocalEcho(text);
      deps.toast(`send failed: ${error.message}`, "error");
    }
  }

  async function abort() {
    try {
      await deps.rpc({ type: "abort" }, { wait: false });
      deps.toast("aborted");
    } catch (error) {
      deps.toast(`abort failed: ${error.message}`, "error");
    }
  }

  function keydown(event) {
    if (event.isComposing || commandRuntime?.isOpen()) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (history.navigate(event.key === "ArrowUp" ? -1 : 1)) event.preventDefault();
    }
  }

  const detachUiActions = [
    deps.uiActions.register(COMPOSER_INPUT_ACTION, inputChanged),
    deps.uiActions.register(COMPOSER_KEYDOWN_ACTION, keydown),
    deps.uiActions.register(COMPOSER_SEND_ACTION, send),
    deps.uiActions.register(COMPOSER_ABORT_ACTION, abort),
  ];

  function configureCommands(commandDeps) {
    if (commandRuntime) return commandRuntime;
    const palette = commandDeps.findElement("cmdPalette");
    const guard = createCommandGuard({ rpc: deps.rpc, confirm: commandDeps.confirm });
    let state = null;
    let inputController = null;
    const commands = [
      {
        name: "sessions",
        desc: "Open the full sessions manager",
        icon: "◫",
        run() {
          close();
          commandDeps.dialogs.showSessionPicker();
        },
      },
    ];
    let requestVersion = 0;
    const visibleItems = () => state?.mode === "command" ? filterCommands(commands, state.match) : (state?.items ?? []);
    const render = () => {
      if (!state) return;
      const items = visibleItems();
      commandDeps.setPaletteState(state.mode === "command"
        ? commandPaletteView(items, state.match, state.active)
        : pathPaletteView(items, state.trigger, state.active));
    };
    const position = (element) => commandDeps.setPaletteState(commandPalettePosition(element.getBoundingClientRect(), commandDeps.windowTarget));
    const openCommand = (element, match, trigger) => { state = { mode: "command", target: element, match: match || "", active: 0, trigger }; position(element); render(); };
    const openPaths = (element, trigger, items) => { state = { mode: "path", target: element, match: trigger.text, active: 0, trigger, items }; position(element); render(); };
    function close() { requestVersion++; state = null; commandDeps.closePaletteState(); }
    const move = (direction) => {
      if (!state) return;
      const items = visibleItems();
      if (!items.length) return;
      state.active = moveCommandPaletteActive(state.active, items.length, direction);
      render();
    };
    const setActive = (index) => {
      if (!state || state.active === index) return;
      const items = visibleItems();
      if (index < 0 || index >= items.length) return;
      state.active = index;
      render();
    };
    const runActive = () => {
      if (!state) return false;
      const items = visibleItems();
      if (!items.length) { close(); return false; }
      items[state.active].run();
      return true;
    };
    const runIndex = (index) => { if (!state) return false; setActive(index); return runActive(); };
    async function updatePathCompletions(element, trigger, version) {
      try {
        let workdir = commandDeps.getWorkdir();
        if (!workdir && trigger.text.startsWith("./")) {
          const root = await commandDeps.browseFiles("");
          if (version !== requestVersion || pathTrigger(element)?.text !== trigger.text) return;
          workdir = root.workdir ?? root.path;
        }
        const request = pathCompletionRequest(trigger.text, workdir);
        const data = await commandDeps.browseFiles(request.browsePath);
        if (version !== requestVersion || pathTrigger(element)?.text !== trigger.text) return;
        const matches = pathCompletionItems(trigger, request, data);
        if (matches.length > 10) {
          openPaths(element, trigger, [{
            label: "Open file explorer…",
            icon: "📂",
            desc: `${matches.length} matching paths`,
            run() {
              const target = element;
              close();
              commandDeps.showFilePicker((path) => insertAtTextarea(target, trigger.text, path), null, commandDeps.isOverlayOpen(), request.browsePath);
            },
          }]);
          return;
        }
        openPaths(element, trigger, matches.map((match) => ({
          ...match,
          run() {
            close();
            insertAtTextarea(element, trigger.text, match.path);
          },
        })));
      } catch {
        if (version === requestVersion) close();
      }
    }
    function setup(element) {
      inputController?.detach();
      inputController = createCommandPaletteInputController({
        target: element,
        onInput() {
          const version = ++requestVersion;
          const trigger = commandTrigger(element);
          if (trigger && trigger.text.length >= 1) {
            const match = trigger.text.slice(1);
            if (!state || state.mode !== "command" || state.target !== element || state.trigger?.text !== trigger.text) openCommand(element, match, trigger);
            else { state.match = match; state.active = 0; position(element); render(); }
            return;
          }
          const path = pathTrigger(element);
          if (path) {
            state = null;
            commandDeps.closePaletteState();
            updatePathCompletions(element, path, version);
          } else if (state?.target === element) close();
        },
        onBlur: () => commandDeps.schedule(() => { if (state?.target === element) close(); }, 150),
      });
      inputController.attach();
      return inputController;
    }
    const detachPaletteRunAction = commandDeps.uiActions?.register(COMMAND_PALETTE_RUN_ACTION, runIndex) ?? (() => {});
    const keyboardController = createCommandPaletteKeyboardController({
      documentTarget: commandDeps.documentTarget,
      isOpen: () => palette.classList.contains("open"), move, run: runActive, close,
    });
    async function runMenuAction(action) {
      try {
        if (action === "newSession") {
          await commandDeps.session.openNew();
          deps.toast("new session");
        } else if (action === "newSessionIn") {
          await commandDeps.dialogs.showFolderBrowser();
        } else if (action === "sessions") {
          await commandDeps.dialogs.showSessionPicker();
        } else if (action === "compact") {
          deps.toast("compacting…");
          await commandDeps.platform.rpc({ type: "compact" });
          deps.toast("compacted");
          const { messages } = await commandDeps.platform.rpc({ type: "get_messages" });
          commandDeps.transcript.clear();
          for (const message of messages) commandDeps.transcript.renderMessage(message);
        } else if (action === "restart") {
          await commandDeps.platform.restart(commandDeps.session.getCurrentRunner());
          commandDeps.transcript.clear();
          deps.toast("restarting pi…");
        } else if (action === "logout") {
          commandDeps.platform.logout();
        } else if (action === "settings") {
          await commandDeps.dialogs.showSettings();
        }
      } catch (error) {
        deps.toast(error.message, "error");
      }
    }
    const detachMenuAction = commandDeps.uiActions?.register(MENU_ACTION, runMenuAction) ?? (() => {});
    setup(input);
    commandRuntime = {
      guard, setup, keyboardController, runMenuAction,
      isOpen: () => palette.classList.contains("open"),
      teardown() {
        inputController?.detach();
        keyboardController.detach();
        detachPaletteRunAction();
        detachMenuAction();
        close();
        commandRuntime = null;
      },
    };
    return commandRuntime;
  }

  function insertAtTextarea(element, placeholder, text) {
    const insertion = insertionReplacing(element.value, placeholder, text)
      ?? insertionAtCaret(element.value, element.selectionStart, element.selectionEnd, text);
    element.value = insertion.value;
    element.setSelectionRange(insertion.position, insertion.position);
    element.dispatchEvent(new Event("input"));
    element.focus();
  }

  return {
    operations: {
      input,
      inputChanged,
      keydown,
      send,
      abort,
      setText,
      insertText,
      rememberPrompt: (text) => history.remember(text),
      clearHistory: () => history.clear(),
      resetHistory: () => history.reset(),
      navigateHistory: (direction) => history.navigate(direction),
      promptRpcCommand,
      resetCommands: () => commandRuntime?.guard.reset(),
      setupCommandPalette: (element) => commandRuntime.setup(element),
    },
    configureCommands,
    teardown() {
      commandRuntime?.teardown();
      detachUiActions.splice(0).reverse().forEach((detach) => detach());
      history.clear();
    },
  };
}
