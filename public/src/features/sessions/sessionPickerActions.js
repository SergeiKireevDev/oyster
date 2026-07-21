let dispatch;
export function configureSessionPickerActions(next) { dispatch = next; return () => { dispatch = undefined; }; }
export function sessionPickerAction(type, ...args) { return dispatch?.(type, ...args); }
export function cancelSessionPicker() { return dispatch?.("cancel"); }
