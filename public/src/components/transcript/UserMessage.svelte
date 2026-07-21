<script>
  import PermalinkButton from "./PermalinkButton.svelte";

  let { text = "", onPermalink = () => {} } = $props();

  let root = $state();
  const iface = $derived(text.match(/^Opening interface: (.*)\n/));
  const interfaceTitle = $derived(iface ? iface[1] : "");
  const interfaceBody = $derived(iface ? text.slice(iface[0].length) : "");
</script>

{#if iface}
  <details class="block tool" data-role="user" bind:this={root}>
    <summary><span class="tname">opening interface</span><span class="targ">{interfaceTitle}</span></summary>
    <div class="body"><pre>{interfaceBody}</pre></div>
  </details>
{:else}
  <div class="msg user" data-role="user" bind:this={root}>
    {text}<PermalinkButton target={root} {onPermalink} />
  </div>
{/if}
