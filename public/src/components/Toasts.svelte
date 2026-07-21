<script>
  import { toasts } from "../stores/toasts.js";
  import ToastItem from "./ToastItem.svelte";
</script>

<div id="toasts">
  {#each $toasts as toast (toast.id)}
    <ToastItem {toast} />
  {/each}
</div>
