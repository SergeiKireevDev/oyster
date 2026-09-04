/** Prefer durable history and request the runner's full message snapshot only when needed. */
export async function loadCanonicalTranscript({
  getState,
  getMessages,
  getDurableMessages,
  shouldGetDurableMessages = (state) => Boolean(state?.sessionFile),
  shouldGetLiveMessages = (state) => Boolean(state?.isStreaming),
  applyState,
  onState,
  onMessages,
  onDurableMessages,
  mergeLiveMessages = (_durable, live) => live,
}) {
  const state = await getState();
  onState?.(state);
  applyState(state);

  let durable = null;
  if (getDurableMessages && shouldGetDurableMessages(state)) {
    try {
      durable = await getDurableMessages(state);
      onDurableMessages?.(durable);
    } catch {}
  }

  const durableMessages = Array.isArray(durable?.messages) ? durable.messages : null;
  if (durableMessages && !shouldGetLiveMessages(state)) return { messages: durableMessages, state };

  try {
    const live = await getMessages();
    onMessages?.(live);
    if (Array.isArray(live?.messages)) {
      return {
        messages: durableMessages ? mergeLiveMessages(durableMessages, live.messages) : live.messages,
        state,
      };
    }
  } catch (error) {
    if (!durableMessages) throw error;
  }
  return { messages: durableMessages ?? [], state };
}
