/** Run canonical transcript requests in parallel while applying state eagerly. */
export async function loadCanonicalTranscript({ getState, getMessages, applyState, onState, onMessages }) {
  const statePromise = getState().then((state) => {
    onState?.(state);
    applyState(state);
    return state;
  });
  const messagesPromise = getMessages().then((result) => {
    onMessages?.(result);
    return result;
  });
  const [{ messages }, state] = await Promise.all([messagesPromise, statePromise]);
  return { messages: messages ?? [], state };
}
