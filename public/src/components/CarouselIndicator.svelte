<script>
  /** @typedef {-1 | 0 | 1 | 2} CarouselPage */

  /** @type {{ page: CarouselPage }} */
  let { page } = $props();
</script>

<div id="carouselIndicator" style:--carousel-index={page + 1} aria-hidden="true">
  <span class="carousel-track"><span class="carousel-position"></span></span>
</div>
