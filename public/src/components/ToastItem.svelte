<script>
  import { onMount } from "svelte";
  import { removeToast } from "../stores/toasts.js";

  let { toast } = $props();

  let startX = null;
  let dx = 0;
  let swiping = false;
  let transform = $state("");
  let opacity = $state("");
  let dismissing = $state(false);

  onMount(() => {
    if (toast.sticky) return;
    const timer = setTimeout(() => removeToast(toast.id), 4000);
    return () => clearTimeout(timer);
  });

  function pointerdown(event) {
    startX = event.clientX;
    dx = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointermove(event) {
    if (startX === null) return;
    dx = event.clientX - startX;
    if (Math.abs(dx) > 5) {
      swiping = true;
      transform = `translateX(${dx}px)`;
      opacity = String(Math.max(0, 1 - Math.abs(dx) / 150));
    }
  }

  function endSwipe() {
    if (startX === null) return;
    if (Math.abs(dx) > 60) {
      dismissing = true;
      transform = `translateX(${dx > 0 ? 300 : -300}px)`;
      setTimeout(() => removeToast(toast.id), 150);
    } else {
      transform = "";
      opacity = "";
    }
    startX = null;
  }

  function pointerup() {
    endSwipe();
    setTimeout(() => { swiping = false; }, 0);
  }

  function click() {
    if (swiping) return;
    if (!toast.onClick) return;
    removeToast(toast.id);
    toast.onClick();
  }

  function keydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      click();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class={`toast${toast.kind ? ` ${toast.kind}` : ""}${dismissing ? " dismissing" : ""}`}
  role={toast.onClick ? "button" : "status"}
  tabindex={toast.onClick ? "0" : undefined}
  style:cursor={toast.onClick ? "pointer" : undefined}
  style:transform={transform || undefined}
  style:opacity={opacity || undefined}
  onclick={click}
  onkeydown={keydown}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={endSwipe}
>
  {toast.text}
</div>
