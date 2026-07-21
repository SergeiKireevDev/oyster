<script>
  import { onMount, tick } from "svelte";
  import {
    cancelTextPrompt,
    setTextPromptValue,
    submitTextPrompt,
    textPrompt,
  } from "../stores/dialogs.js";

  let inputEl;

  onMount(() => {
    tick().then(() => inputEl?.focus());
  });
</script>

<input
  bind:this={inputEl}
  type="text"
  placeholder={$textPrompt.placeholder}
  value={$textPrompt.value}
  oninput={(event) => setTextPromptValue(event.currentTarget.value)}
  onkeydown={(event) => {
    if (event.key === "Enter") submitTextPrompt();
    else if (event.key === "Escape") cancelTextPrompt();
  }}
/>
