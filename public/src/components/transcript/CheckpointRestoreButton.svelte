<script>
  let { restore, onRollback = () => {} } = $props();
</script>

<button
  class:busy={restore.busy}
  class="ckpt-restore"
  title={`roll the workdir back to checkpoint ${restore.checkpoint.hash} and fork the session here`}
  aria-label={`Roll back to checkpoint ${restore.checkpoint.hash} and fork the session`}
  disabled={restore.busy}
  onclick={(event) => {
    event.stopPropagation();
    onRollback(restore.checkpoint);
  }}
>↩</button>
