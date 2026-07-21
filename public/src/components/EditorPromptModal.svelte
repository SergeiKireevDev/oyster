<script>
  import { onMount, tick } from "svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const editorPrompt = dialogs.editorPrompt;

  let inputEl;

  onMount(() => {
    tick().then(() => inputEl?.focus());
  });
</script>

<textarea
  bind:this={inputEl}
  placeholder={$editorPrompt.placeholder}
  value={$editorPrompt.value}
  spellcheck="false"
  style="width:100%;height:42vh;resize:vertical;font:12.5px/1.5 ui-monospace,monospace;white-space:pre;tab-size:4;box-sizing:border-box;"
  oninput={(event) => dialogs.setEditorValue(event.currentTarget.value)}
  onkeydown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") dialogs.submitEditor();
    else if (event.key === "Escape") dialogs.cancelEditor();
  }}
></textarea>

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={dialogs.cancelEditor}>Cancel</button>
  <button class="btn" style="padding:6px 16px;" onclick={dialogs.submitEditor}>OK</button>
</div>
