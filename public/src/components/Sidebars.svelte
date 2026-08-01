<script>
  import HublotSidebar from "./HublotSidebar.svelte";
  import CheckpointTreebar from "./CheckpointTreebar.svelte";
</script>

<!--
  Keep both auxiliary panels unwrapped: they are direct flex children of #main
  in ChatLayout and expose the shared .workspace-aux-sidebar visual contract.
-->
<HublotSidebar />
<CheckpointTreebar />
