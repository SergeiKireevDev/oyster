<script>
  /** @typedef {-1 | 0 | 1 | 2} CarouselPage */

  /** @type {{ page: CarouselPage }} */
  let { page } = $props();
</script>

<div
  id="carouselIndicator"
  class="carousel-indicator"
  style:--carousel-index={page + 1}
  aria-hidden="true"
>
  <span class="carousel-track"><span class="carousel-position"></span></span>
</div>

<style>
  .carousel-indicator { display: none; }

  @media (max-width: 760px) {
    .carousel-indicator {
      position: fixed;
      bottom: max(2px, env(safe-area-inset-bottom));
      left: 50%;
      z-index: 56;
      display: block;
      width: 72px;
      height: 2px;
      pointer-events: none;
      translate: -50% 0;
      transition: opacity .16s ease;
    }

    .carousel-track {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--muted) 28%, transparent);
    }

    .carousel-position {
      position: absolute;
      inset: 0 auto 0 0;
      width: 25%;
      border-radius: inherit;
      background: var(--accent);
      transform: translateX(calc(var(--carousel-index) * 100%));
      transition: transform .25s ease;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .carousel-indicator,
    .carousel-position { transition: none; }
  }
</style>
