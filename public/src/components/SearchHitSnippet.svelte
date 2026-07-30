<script>
  import { highlightSearchSnippet } from "../lib/sessionSearchHighlight.js";

  export let role;
  export let kind;
  export let snippet;
  export let query = "";
  export let copyClass = undefined;

  function roleLabel(value, fallback) {
    if (value === "user") return "you";
    if (value === "assistant") return "ai";
    if (value === "toolResult") return "tool";
    return fallback;
  }

  $: label = roleLabel(role, kind);
  $: segments = highlightSearchSnippet(snippet, query);
</script>

<span class="s-role">{label}</span>{" "}<span class={copyClass}>{#each segments as segment}{#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}{/each}</span>
