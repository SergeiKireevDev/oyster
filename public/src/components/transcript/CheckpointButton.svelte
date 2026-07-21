<script>
  let { onCheckpoint = () => {}, busy = false } = $props();
</script>

<span
  class:busy
  class="checkpoint"
  title="checkpoint — commit all workdir changes"
  role="button"
  tabindex="0"
  onclick={(event) => onCheckpoint(event)}
  onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCheckpoint(event);
    }
  }}
>🧊</span>
