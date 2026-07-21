import { writable } from "svelte/store";

export const commandPalette = writable({
  open: false,
  mode: "command",
  left: "0px",
  top: "auto",
  bottom: "auto",
  width: "280px",
  maxHeight: "320px",
  match: "",
  emptyText: "",
  items: [],
});

export function setCommandPaletteState(patch) {
  commandPalette.update((state) => ({ ...state, ...patch }));
}

export function closeCommandPaletteState() {
  commandPalette.update((state) => ({ ...state, open: false, mode: "command", items: [], emptyText: "" }));
}
