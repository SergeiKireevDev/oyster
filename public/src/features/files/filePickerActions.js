let actions = {};

export function configureFilePickerActions(nextActions) {
  actions = nextActions;
  return () => { actions = {}; };
}

export function browseFilePicker(path) { return actions.browse?.(path); }
export function pickFilePicker(path) { return actions.pick?.(path); }
