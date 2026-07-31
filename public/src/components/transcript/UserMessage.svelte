<script>
  import PermalinkButton from "./PermalinkButton.svelte";
  import CopyMessageButton from "./CopyMessageButton.svelte";
  import CheckpointButton from "./CheckpointButton.svelte";
  import CheckpointRestoreButton from "./CheckpointRestoreButton.svelte";
  import { reportNode } from "../../lib/nodeReporter.js";

  const INTERFACE_PREFIX = "Opening interface: ";

  /** @typedef {Record<string, unknown> & { hash: string }} Checkpoint */
  /** @typedef {{ target: HTMLElement | null, busy: boolean }} CheckpointMarker */
  /** @typedef {{ target: HTMLElement, checkpoint: Checkpoint, busy?: boolean }} RestoreState */
  /** @typedef {{ title: string, body: string }} InterfaceMessage */
  /**
   * @typedef {object} Props
   * @property {string} [text]
   * @property {CheckpointMarker} [checkpoint]
   * @property {RestoreState[]} [restores]
   * @property {(target: HTMLElement | null) => void} [onPermalink]
   * @property {(text: string) => void} [onCopy]
   * @property {() => void} [onCheckpoint]
   * @property {(checkpoint: Checkpoint) => void} [onRollback]
   * @property {(root: HTMLElement) => void} [onRoot]
   */

  /** @type {Props} */
  let {
    text = "",
    checkpoint = { target: null, busy: false },
    restores = [],
    onPermalink = () => {},
    onCopy = () => {},
    onCheckpoint = () => {},
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
  <details class="block tool" class:ckpt-frozen={restore !== null} data-role="user" bind:this={root} use:reportNode={onRoot}>
    <summary>
      <span class="tname">opening interface</span>
      <span class="targ">{interfaceMessage.title}</span>
    </summary>
    <div class="body"><pre>{interfaceMessage.body}</pre></div>
    {@render checkpointActions()}
  </details>
{:else}
  <div class="message-row user-message-row" data-role="user" bind:this={root} use:reportNode={onRoot}>
    <div
      class="msg user"
      class:ckpt-frozen={restore !== null}
      tabindex="-1"
      onpointerdowncapture={selectOnFirstTouch}
    >
      {text}<PermalinkButton target={root} {onPermalink} />
      <CopyMessageButton {text} {onCopy} />
      {@render checkpointActions()}
    </div>
  </div>
{/if}

{#snippet checkpointActions()}
  {#if root !== null && checkpoint.target === root}
    <CheckpointButton {onCheckpoint} busy={checkpoint.busy} />
  {/if}
  {#if restore !== null}
    <CheckpointRestoreButton {restore} {onRollback} />
  {/if}
{/snippet}
