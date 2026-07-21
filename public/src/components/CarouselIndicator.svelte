<script>
  import { carouselPage } from "../stores/carousel.js";
</script>

<div id="carouselIndicator" style={`--carousel-index: ${$carouselPage + 1}`} aria-hidden="true">
  <span class="carousel-track"><span class="carousel-position"></span></span>
</div>
