export function createCheckpointController({
  pickModel,
  createCheckpoint,
  rollbackCheckpoint,
  resultMessage,
  getRunner,
  getSessionId,
  setBusy,
  setRestoreBusy,
  refreshMarkers,
  refreshTree,
  switchRunner,
  toast,
}) {
  let busy = false;

  async function freeze(event) {
    event?.stopPropagation();
    if (busy) return;
    const pick = await pickModel();
    if (pick.cancelled) return;
    busy = true;
    setBusy(true);
    if (pick.model) toast(`🧊 summarizing diff with ${pick.model}…`);
    try {
      const data = await createCheckpoint(getRunner(), pick.model);
      toast(resultMessage(data));
      if (data.recorded) {
        refreshMarkers().catch(() => {});
        refreshTree();
      }
    } catch (error) {
      toast(`checkpoint failed: ${error.message}`, "error");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function rollback(checkpoint, target = null) {
    const pick = await pickModel({
      title: `Roll back to ${checkpoint.hash}`,
      hint: "Pending changes are committed first (nothing is lost) — the model summarizes them into that commit's message — then the workdir is reset and a forked session opens at this message.",
      okLabel: "Roll back ⏪",
    });
    if (pick.cancelled) return;
    if (target) setRestoreBusy(target, true);
    try {
      const data = await rollbackCheckpoint({ sessionId: checkpoint.sessionId ?? getSessionId(), hash: checkpoint.hash, model: pick.model });
      toast(`⏪ rolled back to ${data.rolledBack}${data.safety ? ` (pending work saved as ${data.safety})` : ""} — forked session opened`);
      if (data.runner?.id) switchRunner(data.runner.id);
    } catch (error) {
      toast(`rollback failed: ${error.message}`, "error");
    } finally {
      if (target) setRestoreBusy(target, false);
    }
  }

  return { freeze, rollback };
}
