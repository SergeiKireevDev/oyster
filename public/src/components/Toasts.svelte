<script>
  import { removeToast, toasts } from "../stores/toasts.js";
  import ToastItem from "./ToastItem.svelte";
</script>

<section id="toasts" class="toast-stack" aria-label="Notifications">
  {#each $toasts as toast (toast.id)}
    <ToastItem {toast} onDismiss={removeToast} />
  {/each}
</section>
