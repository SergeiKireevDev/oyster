<script>
  let { restore, onRollback = () => {} } = $props();
</script>

<button
  class:busy={restore.busy}
  class="ckpt-restore"
  title={`roll the workdir back to checkpoint ${restore.checkpoint.hash} and fork the session here`}
  onclick={(event) => {
    event.stopPropagation();
    onRollback(restore.checkpoint, restore.target);
  }}
>↩</button>
