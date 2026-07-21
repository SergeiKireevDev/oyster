export function createRoutineFeature({ createController, dependencies }) {
  const controller = createController(dependencies);
  return { ...controller, teardown: () => controller.teardown?.() };
}
