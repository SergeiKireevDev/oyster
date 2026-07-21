export function createCheckpointMarkerController({ tick, chatElements, setTarget, setRestores, fetchImpl, getSessionId, fetchSessionEntries }) {
  function place() {
    void tick().then(() => {
      const elements = chatElements();
      setTarget(elements[elements.length - 1] ?? null);
    });
  }

  async function refresh() {
    setRestores([]);
    const sessionId = getSessionId();
    if (!sessionId) return;
    const response = await fetchImpl(`/checkpoints?id=${encodeURIComponent(sessionId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !(data.checkpoints ?? []).length) return;
    let entries;
    try { entries = await fetchSessionEntries(); } catch { return; }
    const byAnchor = new Map(data.checkpoints.map((checkpoint) => [checkpoint.anchorId, checkpoint]));
    const elements = chatElements();
    const restores = [];
    for (let index = 0; index < entries.length; index++) {
      const checkpoint = { ...byAnchor.get(entries[index].id), sessionId };
      if (!checkpoint.hash) continue;
      const position = entries.length === elements.length ? index : elements.length - (entries.length - index);
      if (elements[position]) restores.push({ target: elements[position], checkpoint, busy: false });
    }
    setRestores(restores);
  }

  return { place, refresh };
}
