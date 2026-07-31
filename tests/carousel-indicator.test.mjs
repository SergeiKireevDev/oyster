import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carouselPage, setCarouselPage } from "../public/src/stores/carousel.js";

const component = readFileSync(new URL("../public/src/components/CarouselIndicator.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("mobile carousel uses a thin, safe-area-aware bottom rail instead of dots", () => {
  assert.match(component, /id="carouselIndicator"/);
  assert.match(component, /class="carousel-track"/);
  assert.match(component, /class="carousel-position"/);
  assert.doesNotMatch(component, /\bdot(?:s)?\b/i);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?bottom:\s*max\(2px, env\(safe-area-inset-bottom\)\);[\s\S]*?height:\s*2px;/);
});

test("carousel presentation is component-scoped, theme-token based, and motion-safe", () => {
  assert.match(component, /\.carousel-indicator\s*\{ display: none; \}/);
  assert.match(component, /background:\s*color-mix\(in srgb, var\(--muted\) 28%, transparent\)/);
  assert.match(component, /background:\s*var\(--accent\)/);
  assert.match(component, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none/);
  assert.doesNotMatch(styles, /#carouselIndicator \.carousel-(?:track|position)/, "component rendering stays out of the global cascade");
  assert.match(styles, /body:has\(#overlay\.open\) #carouselIndicator/);
  assert.match(styles, /body:has\(#cmdPalette\.open\) #carouselIndicator/);
});

test("carousel page is required and reactively mapped to its zero-based position", () => {
  assert.match(component, /@typedef \{-1 \| 0 \| 1 \| 2\} CarouselPage/);
  assert.match(component, /let \{ page \} = \$props\(\);/);
  assert.match(component, /style:--carousel-index=\{page \+ 1\}/);
  assert.doesNotMatch(component, /page\s*=/);
});

test("carousel indicator represents the sessions page to the left of chat", () => {
  let current;
  const unsubscribe = carouselPage.subscribe((value) => { current = value; });
  setCarouselPage(-1);
  assert.equal(current, -1);
  setCarouselPage(0);
  unsubscribe();
});
