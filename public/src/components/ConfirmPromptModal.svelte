<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const confirmPrompt = dialogs.confirmPrompt;
</script>

{$confirmPrompt.message}

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={() => dialogs.answerConfirm(false)}>No</button>
  <button class="btn" style="padding:6px 16px;" onclick={() => dialogs.answerConfirm(true)}>Yes</button>
</div>
