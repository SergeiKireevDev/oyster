<script>
  import oysterIcon from "../assets/oyster.png";
  import { TUTORIAL_STEPS } from "../features/tutorial/tutorialSteps.js";
  import { tutorialPresentation } from "../lib/tutorialDomAdapters.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    TUTORIAL_DISMISS_ACTION,
    TUTORIAL_NEXT_ACTION,
    TUTORIAL_PREVIOUS_ACTION,
  } from "../runtime/uiActionNames.js";
  import { tutorialState } from "../stores/tutorial.js";

  const uiActions = getUiActionRegistry();

  $: currentStep = TUTORIAL_STEPS[$tutorialState.stepIndex] ?? TUTORIAL_STEPS[0];
  $: finalStep = $tutorialState.stepIndex === TUTORIAL_STEPS.length - 1;

  function next() {
    uiActions.invoke(TUTORIAL_NEXT_ACTION);
  }

  function previous() {
    uiActions.invoke(TUTORIAL_PREVIOUS_ACTION);
  }

  function dismiss() {
    uiActions.invoke(TUTORIAL_DISMISS_ACTION);
  }
</script>

{#if $tutorialState.active}
  <div
    class="tutorial-layer"
    use:tutorialPresentation={{
      targets: currentStep.targets,
      stepIndex: $tutorialState.stepIndex,
      onNext: next,
      onPrevious: previous,
      onDismiss: dismiss,
    }}
  >
    <div class="tutorial-spotlight" aria-hidden="true"></div>
    <div class="tutorial-scrim" aria-hidden="true"></div>

    <div
      class="tutorial-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorialTitle"
      aria-describedby="tutorialDescription"
      tabindex="-1"
    >
      <header class="tutorial-heading">
        <img src={oysterIcon} alt="" />
        <div>
          <span class="tutorial-progress-label">Step {$tutorialState.stepIndex + 1} of {TUTORIAL_STEPS.length}</span>
          <h2 id="tutorialTitle">{currentStep.title}</h2>
        </div>
      </header>

      <p id="tutorialDescription">{currentStep.description}</p>

      <div class="tutorial-progress" aria-hidden="true">
        {#each TUTORIAL_STEPS as step, index (step.title)}
          <span class:current={index === $tutorialState.stepIndex}></span>
        {/each}
      </div>

      <footer class="tutorial-actions">
        <button class="tutorial-skip" type="button" onclick={dismiss}>Skip tour</button>
        <span class="tutorial-navigation">
          {#if $tutorialState.stepIndex > 0}
            <button class="chip" type="button" onclick={previous}>Back</button>
          {/if}
          <button class="btn" type="button" onclick={next}>{finalStep ? "Finish" : "Next"}</button>
        </span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .tutorial-layer {
    position: fixed;
    inset: 0;
    z-index: 90;
    overflow: hidden;
    pointer-events: auto;
  }

  .tutorial-scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(2px);
  }

  .tutorial-spotlight {
    position: fixed;
    display: none;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--accent) 88%, white);
    border-radius: 14px;
    box-shadow: 0 0 0 9999px color-mix(in srgb, var(--bg) 72%, transparent), 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
    transition: inset .2s ease, width .2s ease, height .2s ease;
  }

  .tutorial-card {
    position: fixed;
    display: grid;
    width: min(380px, calc(100vw - 28px));
    max-height: calc(100dvh - 28px);
    min-width: 0;
    box-sizing: border-box;
    overflow-y: auto;
    gap: 16px;
    padding: 20px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    border-radius: 16px;
    outline: 0;
    background: color-mix(in srgb, var(--panel-2) 97%, transparent);
    box-shadow: var(--shadow-lg), inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent);
    opacity: 0;
    transform: translateY(4px);
    transition: left .2s ease, top .2s ease, opacity .14s ease, transform .14s ease;
  }

  .tutorial-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .tutorial-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
  }

  .tutorial-heading img {
    width: 38px;
    height: 38px;
    flex: none;
    filter: drop-shadow(0 0 7px color-mix(in srgb, var(--accent) 38%, transparent));
  }

  .tutorial-heading > div { display: grid; min-width: 0; gap: 3px; }

  .tutorial-progress-label {
    color: var(--accent);
    font-size: 9px;
    font-weight: 720;
    letter-spacing: .09em;
    text-transform: uppercase;
  }

  .tutorial-heading h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 680;
    letter-spacing: -.015em;
    line-height: 1.2;
  }

  #tutorialDescription {
    margin: 0;
    color: color-mix(in srgb, var(--text) 76%, var(--muted));
    font-size: 12.5px;
    line-height: 1.6;
  }

  .tutorial-progress { display: flex; align-items: center; gap: 6px; }

  .tutorial-progress span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 45%, transparent);
    transition: width .16s ease, background .16s ease;
  }

  .tutorial-progress span.current { width: 20px; background: var(--accent); }

  .tutorial-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .tutorial-skip {
    min-height: 34px;
    padding: 5px 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .tutorial-skip:hover { color: var(--text); text-decoration: underline; }
  .tutorial-navigation { display: flex; align-items: center; gap: 8px; }
  .tutorial-navigation :is(.chip, .btn) { min-width: 72px; min-height: 36px; }

  @media (max-width: 520px) {
    .tutorial-card { gap: 14px; padding: 17px; }
    .tutorial-actions { align-items: stretch; flex-direction: column-reverse; }
    .tutorial-skip { align-self: center; }
    .tutorial-navigation { width: 100%; }
    .tutorial-navigation :is(.chip, .btn) { min-height: 42px; flex: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .tutorial-spotlight,
    .tutorial-card,
    .tutorial-progress span { transition: none; }
  }
</style>
