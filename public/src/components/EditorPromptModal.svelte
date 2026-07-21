<script>
  import { onMount, tick } from "svelte";
  import {
    cancelEditorPrompt,
    editorPrompt,
    setEditorPromptValue,
    submitEditorPrompt,
  } from "../stores/dialogs.js";

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
  oninput={(event) => setEditorPromptValue(event.currentTarget.value)}
  onkeydown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitEditorPrompt();
    else if (event.key === "Escape") cancelEditorPrompt();
  }}
></textarea>
