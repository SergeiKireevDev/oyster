/** Route extension UI requests through injected Svelte dialog and toast actions. */
export function createExtensionUiController({ respond, toast, confirm, select, input, editor, setTitle }) {
  return async (request) => {
    switch (request.method) {
      case "notify": return toast(request.message, request.notifyType);
      case "confirm": return respond(request.id, (await confirm(request.title, request.message)) ? { confirmed: true } : { confirmed: false });
      case "select": { const index = await select(request.title, request.options); return respond(request.id, index == null ? { cancelled: true } : { value: request.options[index] }); }
      case "input": { const value = await input(request.title, request.placeholder); return respond(request.id, value == null ? { cancelled: true } : { value }); }
      case "editor": { const value = await editor(request.title, "", request.prefill); return respond(request.id, value == null ? { cancelled: true } : { value }); }
      case "setTitle": return setTitle(request.title);
      default: return undefined;
    }
  };
}
