<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const confirmPrompt = dialogs.confirmPrompt;

  function answerNo() {
    dialogs.answerConfirm(false);
  }

  function answerYes() {
    dialogs.answerConfirm(true);
  }
</script>

<p>{$confirmPrompt.message}</p>

<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel onclick={answerNo}>No</button>
  <button class="btn modal-primary-action" type="button" onclick={answerYes}>Yes</button>
</div>
