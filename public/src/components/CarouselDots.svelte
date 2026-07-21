<script>
  import { carouselPage } from "../stores/carousel.js";
</script>

<div id="carouselDots" aria-hidden="true">
  {#each [0, 1, 2] as page}
    <span class:active={$carouselPage === page} class="dot"></span>
  {/each}
</div>
