import { createFilesFeature } from "./createFilesFeature.js";

export function createFilesRuntime(deps) {
  const state = { picker: deps.pickerState(), folder: deps.folderState(), explorer: deps.explorerState() };
  const controllers = createFilesFeature({
    picker: deps.picker({ state }),
    folderBrowser: deps.folderBrowser({ state }),
    explorer: deps.explorer({ state }),
  });
  return { state, ...controllers };
}
