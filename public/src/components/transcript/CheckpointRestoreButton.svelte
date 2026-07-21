<script>
  let { restore, onRollback = () => {} } = $props();
</script>

<span
  class:busy={restore.busy}
  class="ckpt-restore"
  title={`roll the workdir back to checkpoint ${restore.checkpoint.hash} and fork the session here`}
  role="button"
  tabindex="0"
  onclick={(event) => {
    event.stopPropagation();
    onRollback(restore.checkpoint, restore.target);
  }}
  onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onRollback(restore.checkpoint, restore.target);
    }
  }}
>↩</span>
