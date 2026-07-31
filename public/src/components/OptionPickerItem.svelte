<script>
  import { scrollIntoViewWhen } from "../lib/modalDomAdapters.js";

  export let text = "";
  export let index = -1;
  export let query = "";
  export let modelMode = false;
  export let active = false;
  export let selected = false;
  export let onChoose = () => {};
  export let onActivate = () => {};

  function highlight(value) {
    const content = String(value);
    const matchIndex = query ? content.toLowerCase().indexOf(query) : -1;
    return matchIndex < 0
      ? { before: content, match: "", after: "" }
      : {
          before: content.slice(0, matchIndex),
          match: content.slice(matchIndex, matchIndex + query.length),
          after: content.slice(matchIndex + query.length),
        };
  }

  $: separator = String(text).indexOf("/");
  $: providerText = separator < 0 ? "custom" : String(text).slice(0, separator);
  $: modelText = separator < 0 ? String(text) : String(text).slice(separator + 1);
  $: provider = highlight(providerText);
  $: model = highlight(modelText);
</script>

{#if modelMode}
  <button
    class="model-autocomplete-option"
    class:active
    class:selected
    data-option-index={index}
    role="option"
    aria-selected={selected}
    use:scrollIntoViewWhen={active}
    onclick={() => onChoose(index)}
    onmousemove={() => onActivate(index)}
  >
    <span class="model-provider">{provider.before}{#if provider.match}<mark>{provider.match}</mark>{/if}{provider.after}</span>
    <span class="model-name">{model.before}{#if model.match}<mark>{model.match}</mark>{/if}{model.after}</span>
    {#if selected}<span class="model-selected-mark" aria-label="Current model">✓</span>{/if}
    {#if active}<span class="model-enter-hint" aria-hidden="true">↵</span>{/if}
  </button>
{:else}
  <button
    class="m-option"
    class:active
    data-option-index={index}
    role="option"
    aria-selected={active}
    use:scrollIntoViewWhen={active}
    onclick={() => onChoose(index)}
    onmousemove={() => onActivate(index)}
  >{text}</button>
{/if}
