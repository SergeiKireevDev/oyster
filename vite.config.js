import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  root: "public",
  publicDir: false,
  plugins: [svelte()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
