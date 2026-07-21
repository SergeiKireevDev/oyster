<script>
  let { size = 16, class: className = "" } = $props();
</script>

<span class={`folder-icon ${className}`.trim()} style={`--folder-icon-size:${size}px`} aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h4.1l2.05 2.15h6.35a2.25 2.25 0 0 1 2.25 2.25v7.35A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25v-9.5Z" />
    <path d="M3.75 10h16.5" />
  </svg>
</span>
