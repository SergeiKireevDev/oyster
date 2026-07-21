/** Shell-style prompt history with multiline-aware arrow navigation. */
export function createComposerHistoryController({ getValue, getSelection, setValue }) {
  const history = [];
  let index = null;
  let draft = "";

  function remember(text) {
    if (!text || history.at(-1) === text) return;
    history.push(text);
    index = null;
  }

  function reset() {
    index = null;
  }

  function clear() {
    history.length = 0;
    index = null;
    draft = "";
  }

  function navigate(direction) {
    if (!history.length) return false;
    const value = getValue();
    const { start, end } = getSelection();
    const onFirstLine = !value.slice(0, start).includes("\n");
    const onLastLine = !value.slice(end).includes("\n");
    if (direction === -1) {
      if (!onFirstLine) return false;
      if (index === null) {
        draft = value;
        index = history.length - 1;
      } else if (index > 0) {
        index--;
      } else {
        return true;
      }
      setValue(history[index]);
      return true;
    }
    if (index === null || !onLastLine) return false;
    if (index < history.length - 1) {
      index++;
      setValue(history[index]);
    } else {
      index = null;
      setValue(draft);
    }
    return true;
  }

  return { remember, reset, clear, navigate };
}
