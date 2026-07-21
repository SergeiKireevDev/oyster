<script>
  let { target = null, onPermalink = () => {} } = $props();
</script>

<button
  type="button"
  class="permalink"
  title="copy a permalink to this message"
  onclick={(event) => { event.stopPropagation(); onPermalink(target); }}
>🔗</button>
