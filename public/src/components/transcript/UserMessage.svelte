<script>
  import AssistantPartActions from "./AssistantPartActions.svelte";
  import { reportNode } from "../../lib/nodeReporter.js";

  const INTERFACE_PREFIX = "Opening interface: ";

  /** @typedef {Record<string, unknown> & { hash: string }} Checkpoint */
  /** @typedef {{ target: HTMLElement, checkpoint: Checkpoint, busy?: boolean }} RestoreState */
  /** @typedef {{ title: string, body: string }} InterfaceMessage */
  /**
   * @typedef {object} Props
   * @property {string} [text]
   * @property {RestoreState[]} [restores]
   * @property {(target: HTMLElement | null) => void} [onPermalink]
   * @property {(text: string) => void} [onCopy]
   * @property {(checkpoint: Checkpoint) => void} [onRollback]
   * @property {(root: HTMLElement) => void} [onRoot]
   */

  /** @type {Props} */
  let {
    text = "",
    restores = [],
    onPermalink = () => {},
    onCopy = () => {},
    onRollback = () => {},
    onRoot = () => {},
  } = $props();

  /** @type {HTMLElement | null} */
  let root = $state(null);
  const interfaceMessage = $derived(parseInterfaceMessage(text));
  const restore = $derived(
    root === null ? null : (restores.find((item) => item.target === root) ?? null),
  );

  /**
   * Interface notifications use the first line as their summary and retain the
   * rest verbatim for the expandable body. Accept a missing final newline so a
   * title-only notification is still presented as an interface notification.
   *
   * @param {string} value
   * @returns {InterfaceMessage | null}
   */
  function parseInterfaceMessage(value) {
    if (!value.startsWith(INTERFACE_PREFIX)) return null;

    const titleStart = INTERFACE_PREFIX.length;
    const lineEnd = value.indexOf("\n", titleStart);
    if (lineEnd === -1) {
      return { title: value.slice(titleStart).replace(/\r$/, ""), body: "" };
    }

    return {
      title: value.slice(titleStart, lineEnd).replace(/\r$/, ""),
      body: value.slice(lineEnd + 1),
    };
  }

  /** @param {PointerEvent & { currentTarget: HTMLElement }} event */
  function selectOnFirstTouch(event) {
    if (event.pointerType !== "touch" || event.currentTarget.matches(":focus-within")) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
  }
</script>

{#if interfaceMessage}
  <details class="block tool interface-message" class:ckpt-frozen={restore !== null} data-role="user" bind:this={root} use:reportNode={onRoot}>
    <summary>
      <span class="tname">opening interface</span>
      <span class="targ">{interfaceMessage.title}</span>
    </summary>
    <div class="body">
      {#if interfaceMessage.body}
        <pre>{interfaceMessage.body}</pre>
      {:else}
        <p class="empty-interface">No interface details provided.</p>
      {/if}
    </div>
    <AssistantPartActions
      label="User message actions"
      target={root}
      copyText={text}
      copy
      {onPermalink}
      {onCopy}
      {onRollback}
      {restore}
    />
  </details>
{:else}
  <div class="message-row user-message-row" data-role="user" bind:this={root} use:reportNode={onRoot}>
    <div
      class="msg user user-message"
      class:ckpt-frozen={restore !== null}
      tabindex="-1"
      onpointerdowncapture={selectOnFirstTouch}
    >
      {text}
      <AssistantPartActions
        label="User message actions"
        target={root}
        copyText={text}
        copy
        {onPermalink}
        {onCopy}
        {onRollback}
        {restore}
      />
    </div>
  </div>
{/if}


<style>
  .message-row {
    display: flex;
    width: 100%;
    min-width: 0;
  }

  .user-message-row { justify-content: flex-end; }

  .user-message {
    align-self: flex-end;
    max-width: min(74%, 660px);
    min-width: 0;
    position: relative;
    padding: 10px 15px;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 18px 18px 5px 18px;
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--user-bubble) 94%, var(--accent)),
      var(--user-bubble)
    );
    box-shadow:
      0 10px 30px color-mix(in srgb, var(--bg) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent);
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .user-message:focus { outline: none; }

  .user-message:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .user-message.ckpt-frozen {
    border-inline-start: 3px solid color-mix(in srgb, var(--accent) 64%, var(--border));
    box-shadow:
      0 10px 30px color-mix(in srgb, var(--bg) 14%, transparent),
      0 0 12px color-mix(in srgb, var(--accent) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent);
  }

  .interface-message {
    width: 100%;
    max-width: 840px;
    min-width: 0;
    position: relative;
    border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
    background: color-mix(in srgb, var(--panel-2) 72%, transparent);
  }

  .interface-message.ckpt-frozen {
    border-inline-start: 3px solid color-mix(in srgb, var(--accent) 64%, var(--border));
  }

  .interface-message > summary { min-width: 0; }

  .tname {
    flex: none;
    color: color-mix(in srgb, var(--accent) 82%, var(--text));
    font-size: 9.5px;
    font-weight: 680;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .targ {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font: 11px/1.3 var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .interface-message > .body { min-width: 0; }

  .interface-message pre {
    max-width: 100%;
    max-height: 55vh;
    margin: 0;
    overflow: auto;
    overscroll-behavior: contain;
    color: color-mix(in srgb, var(--text) 88%, var(--muted));
    font: 12px/1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty-interface {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    font-style: italic;
  }

  @media (max-width: 760px) {
    .user-message {
      max-width: 88%;
      padding: 8px 12px;
      font-size: 13.75px;
      line-height: 1.48;
    }

    .interface-message > summary { min-height: 40px; }
  }
</style>
