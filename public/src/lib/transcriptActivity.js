const isTurnBoundary = (item) => item.kind === "user" || item.kind === "compaction";
const isActivityBlock = (block) => block.type === "thinking" || block.type === "toolCall";

/**
 * Build per-entry render plans while coalescing only consecutive activity.
 * Visible assistant text and user/compaction entries end an activity run, so
 * historical steps stay in their original position in the conversation.
 */
export function interleaveTranscriptActivity(items, messageById) {
  const blocksById = new Map();
  let pendingActivity = null;

  for (const item of items) {
    if (isTurnBoundary(item)) {
      pendingActivity = null;
      continue;
    }

    const message = messageById.get(item.id);
    if (!message) continue;

    const visible = [];
    blocksById.set(item.id, visible);
    let activityPosition = 0;
    let textPosition = 0;

    for (const block of message.blocks ?? []) {
      if (isActivityBlock(block)) {
        if (!pendingActivity) {
          pendingActivity = {
            type: "activityStack",
            renderKey: `activity:${item.id}:${activityPosition}`,
            blocks: [],
          };
          activityPosition += 1;
          visible.push(pendingActivity);
        }
        pendingActivity.blocks.push(block);
        continue;
      }

      if (block.type !== "text") continue;
      const renderKey = `text:${textPosition}`;
      textPosition += 1;
      if (!block.text) continue;

      pendingActivity = null;
      visible.push({ ...block, renderKey });
    }

    if (message.errorMessage) pendingActivity = null;
  }

  return {
    blocksById,
    currentActivityKey: pendingActivity?.renderKey ?? null,
  };
}
