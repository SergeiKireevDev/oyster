import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carouselPage, setCarouselPage } from "../public/src/stores/carousel.js";

const component = readFileSync(new URL("../public/src/components/CarouselIndicator.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("mobile carousel uses a thin bottom rail instead of dots", () => {
  assert.match(component, /id="carouselIndicator"/);
  assert.match(component, /class="carousel-track"/);
  assert.match(component, /class="carousel-position"/);
  assert.doesNotMatch(component, /\bdot(?:s)?\b/i);
  assert.match(styles, /#carouselIndicator\s*\{[\s\S]*?bottom:\s*max\(2px, env\(safe-area-inset-bottom\)\);[\s\S]*?height:\s*2px;/);
});

test("carousel indicator represents the sessions page to the left of chat", () => {
  let current;
  const unsubscribe = carouselPage.subscribe((value) => { current = value; });
  setCarouselPage(-1);
  assert.equal(current, -1);
  setCarouselPage(0);
  unsubscribe();
});
