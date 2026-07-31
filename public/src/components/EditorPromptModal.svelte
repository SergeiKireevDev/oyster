<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const editorPrompt = dialogs.editorPrompt;
</script>

<form onsubmit={(event) => { event.preventDefault(); dialogs.submitEditor(); }}>
  <textarea
    aria-label={$editorPrompt.placeholder || "Editor response"}
    placeholder={$editorPrompt.placeholder}
    value={$editorPrompt.value}
    spellcheck="false"
    class="modal-code-editor modal-code-editor-prompt"
    oninput={(event) => dialogs.setEditorValue(event.currentTarget.value)}
    onkeydown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    }}
  ></textarea>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelEditor}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>
