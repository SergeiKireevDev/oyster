let controller = {};

export function configureOptionPickerController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}
