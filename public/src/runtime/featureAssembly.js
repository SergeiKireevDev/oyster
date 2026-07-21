export function createFeatureAssembly({ platform, sessions, transcript, features }) {
  return { platform, sessions, transcript, features, teardown: () => {
    transcript?.teardown?.(); sessions?.teardown?.(); platform?.teardown?.();
    for (const feature of Object.values(features ?? {})) feature?.teardown?.();
  } };
}
