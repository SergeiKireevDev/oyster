<script>
  export let src = "";
  export let label = "HTML artifact";
</script>

<iframe
  class="pinned-html-preview"
  title={`HTML preview: ${label}`}
  {src}
  sandbox=""
  referrerpolicy="no-referrer"
></iframe>
