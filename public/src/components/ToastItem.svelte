<script>
  import { onDestroy, onMount } from "svelte";
  import { createFrameScheduler } from "../lib/frameScheduler.js";

  let { toast, onDismiss = () => {} } = $props();

  const AUTO_DISMISS_DELAY = 4000;
  const SWIPE_START_THRESHOLD = 5;
  const SWIPE_DISMISS_THRESHOLD = 60;
  const SWIPE_DISTANCE = 300;
  const SWIPE_FADE_DISTANCE = 150;
  const SWIPE_TRANSITION_DELAY = 150;

  let activePointerId = null;
  let startX = null;
  let dx = 0;
  let suppressClick = false;
  let dismissed = false;
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

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function dismissToast() {
    if (dismissed) return false;
    dismissed = true;
    swipeFrame.cancel();
    clearTimers();
    onDismiss(toast.id);
    return true;
  }

  onMount(() => {
    if (!toast.sticky) schedule(dismissToast, AUTO_DISMISS_DELAY);
  });

  onDestroy(() => {
    swipeFrame.cancel();
    clearTimers();
  });

  function handlePointerDown(event) {
    if (dismissed || activePointerId !== null || event.isPrimary === false || event.button !== 0) return;
    activePointerId = event.pointerId;
    startX = event.clientX;
    dx = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateSwipe(clientX) {
    if (startX === null) return;
    dx = clientX - startX;
    if (Math.abs(dx) > SWIPE_START_THRESHOLD) {
      suppressClick = true;
      transform = `translateX(${dx}px)`;
      opacity = String(Math.max(0, 1 - Math.abs(dx) / SWIPE_FADE_DISTANCE));
    }
  }

  function handlePointerMove(event) {
    if (event.pointerId === activePointerId) swipeFrame.schedule(event.clientX);
  }

  function resetSwipe() {
    transform = "";
    opacity = "";
  }

  function finishSwipe(event, allowDismiss) {
    if (event.pointerId !== activePointerId) return;

    swipeFrame.schedule(event.clientX);
    swipeFrame.flush();
    activePointerId = null;
    startX = null;

    if (allowDismiss && Math.abs(dx) > SWIPE_DISMISS_THRESHOLD) {
      dismissing = true;
      transform = `translateX(${dx > 0 ? SWIPE_DISTANCE : -SWIPE_DISTANCE}px)`;
      clearTimers();
      schedule(dismissToast, SWIPE_TRANSITION_DELAY);
    } else {
      resetSwipe();
    }

    swipeFrame.cancel();
    schedule(() => { suppressClick = false; }, 0);
  }

  function handlePointerUp(event) {
    finishSwipe(event, true);
  }

  function handlePointerCancel(event) {
    finishSwipe(event, false);
  }

  function handleLostPointerCapture(event) {
    if (event.pointerId === activePointerId) handlePointerCancel(event);
  }

  function handleClick() {
    if (suppressClick || !toast.onClick || !dismissToast()) return;
    toast.onClick();
  }

</script>

{#snippet toastContent()}
  {#if toast.kind === "warning"}
    <span class="toast-kind" aria-hidden="true">!</span>
  {:else if toast.kind === "error"}
    <span class="toast-kind" aria-hidden="true">×</span>
  {/if}
  <span class="toast-text">{toast.text}</span>
  {#if toast.onClick}
    <span class="toast-action" aria-hidden="true">›</span>
  {/if}
{/snippet}

{#if toast.onClick}
  <button
    type="button"
    class={`toast actionable${toast.kind ? ` ${toast.kind}` : ""}${dismissing ? " dismissing" : ""}`}
    aria-live={toast.kind === "error" ? "assertive" : "polite"}
    aria-atomic="true"
    style:transform={transform || undefined}
    style:opacity={opacity || undefined}
    onclick={handleClick}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onlostpointercapture={handleLostPointerCapture}
  >
    {@render toastContent()}
  </button>
{:else}
  <div
    class={`toast${toast.kind ? ` ${toast.kind}` : ""}${dismissing ? " dismissing" : ""}`}
    role={toast.kind === "error" ? "alert" : "status"}
    aria-atomic="true"
    style:transform={transform || undefined}
    style:opacity={opacity || undefined}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onlostpointercapture={handleLostPointerCapture}
  >
    {@render toastContent()}
  </div>
{/if}
