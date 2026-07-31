<script>
  import { onDestroy, onMount } from "svelte";
  import { createFrameScheduler } from "../lib/frameScheduler.js";

  let { toast, onDismiss = () => {} } = $props();

  let startX = null;
  let dx = 0;
  let swiping = false;
  let transform = $state("");
  let opacity = $state("");
  let dismissing = $state(false);
  const timers = new Set();
  const swipeFrame = createFrameScheduler(updateSwipe);

  function schedule(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  onMount(() => {
    if (!toast.sticky) schedule(() => onDismiss(toast.id), 4000);
  });

  onDestroy(() => {
    swipeFrame.cancel();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });

  function pointerdown(event) {
    startX = event.clientX;
    dx = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateSwipe(clientX) {
    if (startX === null) return;
    dx = clientX - startX;
    if (Math.abs(dx) > 5) {
      swiping = true;
      transform = `translateX(${dx}px)`;
      opacity = String(Math.max(0, 1 - Math.abs(dx) / 150));
    }
  }

  function pointermove(event) {
    if (startX !== null) swipeFrame.schedule(event.clientX);
  }

  function endSwipe() {
    if (startX === null) return;
    swipeFrame.flush();
    if (Math.abs(dx) > 60) {
      dismissing = true;
      transform = `translateX(${dx > 0 ? 300 : -300}px)`;
      schedule(() => onDismiss(toast.id), 150);
    } else {
      transform = "";
      opacity = "";
    }
    startX = null;
    swipeFrame.cancel();
  }

  function pointerup() {
    endSwipe();
    schedule(() => { swiping = false; }, 0);
  }

  function click() {
    if (swiping) return;
    if (!toast.onClick) return;
    onDismiss(toast.id);
    toast.onClick();
  }

</script>

{#if toast.onClick}
  <button
    type="button"
    class={`toast${toast.kind ? ` ${toast.kind}` : ""}${dismissing ? " dismissing" : ""}`}
    aria-live={toast.kind === "error" ? "assertive" : "polite"}
    aria-atomic="true"
    style:transform={transform || undefined}
    style:opacity={opacity || undefined}
    onclick={click}
    onpointerdown={pointerdown}
    onpointermove={pointermove}
    onpointerup={pointerup}
    onpointercancel={endSwipe}
  >
    {toast.text}
  </button>
{:else}
  <div
    class={`toast${toast.kind ? ` ${toast.kind}` : ""}${dismissing ? " dismissing" : ""}`}
    role={toast.kind === "error" ? "alert" : "status"}
    aria-atomic="true"
    style:transform={transform || undefined}
    style:opacity={opacity || undefined}
    onpointerdown={pointerdown}
    onpointermove={pointermove}
    onpointerup={pointerup}
    onpointercancel={endSwipe}
  >
    {toast.text}
  </div>
{/if}
