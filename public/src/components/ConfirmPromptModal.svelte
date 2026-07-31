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

<div class="confirm-prompt">
  <p>{$confirmPrompt.message}</p>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel data-modal-initial-focus onclick={answerNo}>No</button>
    <button class="btn modal-primary-action" type="button" onclick={answerYes}>Yes</button>
  </div>
</div>

<style>
  .confirm-prompt {
    min-width: 0;
  }

  .confirm-prompt > p {
    margin: 0 0 14px;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: 14px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  @media (max-width: 760px) {
    .confirm-prompt .m-actions button {
      min-height: 40px;
    }
  }

  @media (max-width: 520px) {
    .confirm-prompt .m-actions button {
      flex: 1 1 112px;
    }
  }
</style>
