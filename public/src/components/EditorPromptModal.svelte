<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const editorPrompt = dialogs.editorPrompt;

  function submitEditorPrompt(event) {
    event.preventDefault();
    dialogs.submitEditor();
  }

  function updateEditorValue(event) {
    dialogs.setEditorValue(event.currentTarget.value);
  }

  function handleEditorKeydown(event) {
    if (event.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
</script>

<form onsubmit={submitEditorPrompt}>
  <textarea
    aria-label={$editorPrompt.placeholder || "Editor response"}
    placeholder={$editorPrompt.placeholder}
    value={$editorPrompt.value}
    spellcheck="false"
    class="modal-code-editor modal-code-editor-prompt"
    aria-keyshortcuts="Control+Enter Meta+Enter"
    oninput={updateEditorValue}
    onkeydown={handleEditorKeydown}
  ></textarea>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelEditor}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>
