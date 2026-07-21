<script>
  let { text = "", onCopy = () => {} } = $props();
</script>

<button
  type="button"
  class="message-copy"
  title="copy this message"
  aria-label="Copy this message"
  onclick={(event) => { event.stopPropagation(); onCopy(text); }}
>⧉</button>
