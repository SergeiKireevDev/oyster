export function createSettingsLayoutRuntime(deps) {
  const settings = deps.createSettings(deps.settingsDependencies);
  const layout = deps.createLayout(deps.layoutDependencies);
  return { settings, layout, teardown() { settings?.teardown?.(); layout?.teardown?.(); } };
}
