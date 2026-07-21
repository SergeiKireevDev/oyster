export function createLayoutFeature({ createController, dependencies }) {
  const controller = createController(dependencies);
  return { ...controller, teardown: () => controller.teardown?.() };
}
