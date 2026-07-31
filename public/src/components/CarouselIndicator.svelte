<script>
  let { page = 0 } = $props();
</script>

<div id="carouselIndicator" style={`--carousel-index: ${page + 1}`} aria-hidden="true">
  <span class="carousel-track"><span class="carousel-position"></span></span>
</div>
