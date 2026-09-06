import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carouselPage, setCarouselPage } from "../public/src/stores/carousel.js";

const component = readFileSync(new URL("../public/src/components/CarouselIndicator.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("compact workspace navigation exposes named single-pointer alternatives to swipes", () => {
  assert.match(component, /<nav id="carouselIndicator"[^>]*aria-label="Workspace navigation"/);
  for (const [label, target, page] of [["Sessions", "sessions", -1], ["Chat", "chatcol", 0], ["Widgets", "hublots", 1]]) {
    assert.match(component, new RegExp(`aria-controls="${target}"[^\\n]+onNavigate\\(${page}\\)[^\\n]+>${label}</button>`));
  }
  assert.doesNotMatch(component, /aria-hidden|pointer-events:\s*none/);
  assert.match(component, /min-height: 44px/);
  assert.match(component, /env\(safe-area-inset-bottom\)/);
});

test("navigation uses component-owned selected and focus states at the rail breakpoints", () => {
  assert.match(component, /@media \(max-width: 1200px\)/);
  assert.match(component, /@media \(min-width: 961px\)/);
  assert.match(component, /button\[aria-current="page"\][\s\S]*var\(--selection-text\)/);
  assert.match(component, /button:focus-visible/);
  assert.match(styles, /body:has\(#overlay\.open\) #carouselIndicator/);
  assert.match(styles, /body:has\(#cmdPalette\.open\) #carouselIndicator/);
});

test("navigation remains a presentation child receiving state and intent callbacks", () => {
  assert.match(component, /let \{ page, onNavigate \} = \$props\(\);/);
  assert.doesNotMatch(component, /getUiActionRegistry|\/stores\//);
});

test("carousel indicator represents the sessions page to the left of chat", () => {
  let current;
  const unsubscribe = carouselPage.subscribe((value) => { current = value; });
  setCarouselPage(-1);
  assert.equal(current, -1);
  setCarouselPage(0);
  unsubscribe();
});
