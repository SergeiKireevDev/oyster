export function createExtensionUiAdapters({ openOptionPicker, openTextPrompt, openConfirmPrompt, openEditorPrompt, setTitle }) {
  return {
    select: (title, options, { searchable = false, ...presentation } = {}) => openOptionPicker(title, options, { searchable, ...presentation }),
    input: (title, placeholder, prefill) => openTextPrompt(title, placeholder, prefill),
    confirm: (title, message) => openConfirmPrompt(title, message),
    editor: (title, placeholder, prefill) => openEditorPrompt(title, placeholder, prefill),
    setTitle,
  };
}
