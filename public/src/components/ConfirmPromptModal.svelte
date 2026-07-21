<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const confirmPrompt = dialogs.confirmPrompt;
</script>

{$confirmPrompt.message}

<div class="m-actions" id="mActions">
  <span class="chip" role="button" tabindex="0" onclick={() => dialogs.answerConfirm(false)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.answerConfirm(false); }}>No</span>
  <button class="btn" style="padding:6px 16px;" onclick={() => dialogs.answerConfirm(true)}>Yes</button>
</div>
