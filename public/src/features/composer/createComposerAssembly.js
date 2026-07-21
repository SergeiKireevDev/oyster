import { createCommandGuard, commandTrigger, filterCommands } from "../../lib/commandActions.js";
import { commandPalettePosition, commandPaletteView, createCommandPaletteInputController, createCommandPaletteKeyboardController, createCommandPaletteRunController, createMenuEventController, moveCommandPaletteActive } from "../../lib/commandController.js";
import { createComposerHistoryController } from "../../lib/composerHistoryController.js";
import { promptCommand } from "../../lib/promptActions.js";
import { insertionAtCaret, insertionReplacing } from "../../lib/textInsertion.js";
import { configureComposerActions } from "./composerActions.js";

/** Owns composer input, prompt history, send/abort, and local-echo coordination. */
export function createComposerAssembly(deps) {
  const input = deps.findElement("input");
  let commandRuntime = null;

  function setText(text) {
    input.value = text;
    deps.setTextValue(text);
    input.setSelectionRange(text.length, text.length);
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  const history = createComposerHistoryController({
    getValue: () => input.value,
    getSelection: () => ({ start: input.selectionStart, end: input.selectionEnd }),
    setValue: setText,
  });

  function inputChanged() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    deps.setTextValue(input.value);
    deps.setBusy(deps.getBusy());
    history.reset();
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

  const detachActions = configureComposerActions({ inputChanged, keydown, send, abort });

  function configureCommands(commandDeps) {
    if (commandRuntime) return commandRuntime;
    const palette = commandDeps.findElement("cmdPalette");
    const guard = createCommandGuard({ rpc: deps.rpc, confirm: commandDeps.confirm });
    let state = null;
    let inputController = null;
    const commands = [{
      name: "file",
      desc: "Open file explorer and insert a path",
      icon: "📂",
      run() {
        const trigger = commandTrigger(state.target);
        const placeholder = trigger ? trigger.text : null;
        const target = state.target;
        close();
        commandDeps.showFilePicker((path) => insertAtTextarea(target, placeholder, path), null, commandDeps.isOverlayOpen());
      },
    }];
    const filtered = (match) => filterCommands(commands, match);
    const render = () => state && commandDeps.setPaletteState(commandPaletteView(filtered(state.match), state.match, state.active));
    const position = (element) => commandDeps.setPaletteState(commandPalettePosition(element.getBoundingClientRect(), commandDeps.windowTarget));
    const open = (element, match, trigger) => { state = { target: element, match: match || "", active: 0, trigger }; position(element); render(); };
    function close() { state = null; commandDeps.closePaletteState(); }
    const move = (direction) => {
      if (!state) return;
      const items = filtered(state.match);
      if (!items.length) return;
      state.active = moveCommandPaletteActive(state.active, items.length, direction);
      render();
    };
    const setActive = (index) => {
      if (!state || state.active === index) return;
      const items = filtered(state.match);
      if (index < 0 || index >= items.length) return;
      state.active = index;
      render();
    };
    const runActive = () => {
      if (!state) return false;
      const items = filtered(state.match);
      if (!items.length) { close(); return false; }
      items[state.active].run();
      return true;
    };
    const runIndex = (index) => { if (!state) return false; setActive(index); return runActive(); };
    function setup(element) {
      inputController?.detach();
      inputController = createCommandPaletteInputController({
        target: element,
        onInput() {
          const trigger = commandTrigger(element);
          if (trigger && trigger.text.length >= 1) {
            const match = trigger.text.slice(1);
            if (!state || state.target !== element || state.trigger?.text !== trigger.text) open(element, match, trigger);
            else { state.match = match; state.active = 0; position(element); render(); }
          } else if (state?.target === element) close();
        },
        onBlur: () => commandDeps.schedule(() => { if (state?.target === element) close(); }, 150),
      });
      inputController.attach();
      return inputController;
    }
    const runController = createCommandPaletteRunController({ windowTarget: commandDeps.windowTarget, run: runIndex });
    const keyboardController = createCommandPaletteKeyboardController({
      documentTarget: commandDeps.documentTarget,
      isOpen: () => palette.classList.contains("open"), move, run: runActive, close,
    });
    const menuController = createMenuEventController({ windowTarget: commandDeps.windowTarget, run: commandDeps.runMenuAction });
    setup(input);
    commandRuntime = {
      guard, setup, runController, keyboardController, menuController,
      isOpen: () => palette.classList.contains("open"),
      teardown() {
        inputController?.detach();
        keyboardController.detach();
        runController.detach();
        menuController.detach();
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
      detachActions();
      history.clear();
    },
  };
}
