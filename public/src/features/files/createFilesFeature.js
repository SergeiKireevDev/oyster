import { createFilePickerController } from "../../lib/filePickerController.js";
import { createFolderBrowserController } from "../../lib/folderBrowserController.js";
import { createFileExplorerController } from "../../lib/fileExplorerController.js";

/** Constructs the file-browser workflows as one feature-owned runtime. */
export function createFilesFeature({ picker, folderBrowser, explorer }) {
  return {
    picker: createFilePickerController(picker),
    folderBrowser: createFolderBrowserController(folderBrowser),
    explorer: createFileExplorerController(explorer),
  };
}
