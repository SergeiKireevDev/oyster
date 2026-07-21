import { createComposerHistoryController } from "../../lib/composerHistoryController.js";
import { promptCommand } from "../../lib/promptActions.js";
import { configureComposerActions } from "./composerActions.js";

/** Owns composer input, prompt history, send/abort, and local-echo coordination. */
export function createComposerAssembly(deps) {
  const input = deps.findElement("input");

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
    if (!await deps.confirmKnownCommand(text)) return;
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
    if (event.isComposing || deps.isCommandPaletteOpen()) return;
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
    },
    teardown() {
      detachActions();
      history.clear();
    },
  };
}
