<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const editorPrompt = dialogs.editorPrompt;

  let placeholder = $derived(String($editorPrompt.placeholder ?? "").trim());
  let editorLabel = $derived(placeholder || String($editorPrompt.title ?? "").trim() || "Editor response");

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

<form class="editor-prompt" onsubmit={submitEditorPrompt}>
  <label class="editor-prompt-field">
    <span>Response</span>
    <textarea
      aria-label={editorLabel}
      aria-describedby="editorPromptHint"
      placeholder={placeholder}
      value={$editorPrompt.value}
      spellcheck="false"
      class="modal-code-editor modal-code-editor-prompt"
      aria-keyshortcuts="Control+Enter Meta+Enter"
      oninput={updateEditorValue}
      onkeydown={handleEditorKeydown}
    ></textarea>
  </label>

  <p class="editor-prompt-hint" id="editorPromptHint">
    <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to submit
  </p>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelEditor}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>

<style>
  .editor-prompt,
  .editor-prompt-field {
    display: grid;
    min-width: 0;
  }

  .editor-prompt { gap: 7px; }
  .editor-prompt-field { gap: 5px; }

  .editor-prompt-field > span,
  .editor-prompt-hint {
    color: var(--muted);
    font-size: 10.5px;
  }

  .editor-prompt-field > span { font-weight: 620; }

  .editor-prompt .modal-code-editor-prompt {
    height: clamp(220px, 42vh, 420px);
    min-height: 160px;
    max-height: 55vh;
    margin: 0;
    overflow: auto;
    overflow-wrap: normal;
  }

  .editor-prompt-hint {
    margin: 0;
    line-height: 1.45;
    text-align: right;
  }

  .editor-prompt-hint kbd {
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel-2);
    color: var(--text);
    font: 9.5px/1.4 var(--mono);
  }

  @media (max-width: 760px) {
    .editor-prompt .modal-code-editor-prompt { height: clamp(180px, 38vh, 340px); }
    .editor-prompt .m-actions button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .editor-prompt-hint { text-align: left; }
    .editor-prompt .m-actions button { flex: 1 1 112px; }
  }
</style>
