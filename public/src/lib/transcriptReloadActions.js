/** Run canonical transcript requests in parallel while applying state eagerly. */
export async function loadCanonicalTranscript({ getState, getMessages, getDurableMessages, applyState, onState, onMessages, onDurableMessages }) {
  const statePromise = getState().then((state) => { onState?.(state); applyState(state); return state; });
  const messagesPromise = getMessages().then((result) => { onMessages?.(result); return result; });
  const [live, state] = await Promise.all([messagesPromise, statePromise]);
  let durable = null;
  if (getDurableMessages && state?.sessionFile) {
    try { durable = await getDurableMessages(state); onDurableMessages?.(durable); } catch {}
  }
  return { messages: Array.isArray(durable?.messages) ? durable.messages : (live.messages ?? []), state };
}
