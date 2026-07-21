import { writable } from "svelte/store";

export const carouselPage = writable(0);

export function setCarouselPage(page) {
  carouselPage.set(Math.max(-1, Math.min(2, Number(page) || 0)));
}
