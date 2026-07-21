export function createHublotController({ createHublot, getSessionId, setDescription, setCreating, close, toast }) {
  async function create(description) {
    const text = (description ?? "").trim();
    setDescription(description ?? "");
    if (!text) { toast("describe what the hublot should expose", "warning"); return; }
    setCreating(true);
    try {
      const data = await createHublot({ label: text, sessionId: getSessionId(), brief: text });
      setDescription("");
      close();
      toast(`hublot opening at ${data.tunnel.url} — background agent is setting it up…`);
    } catch (error) {
      toast(`hublot failed: ${error.message}`, "error");
    } finally { setCreating(false); }
  }
  return { create };
}
