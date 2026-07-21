let controller = {};

export function configureDialogController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}
