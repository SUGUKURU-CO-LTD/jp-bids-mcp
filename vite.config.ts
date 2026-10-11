import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [react(), viteSingleFile()],
  build: {
    emptyOutDir: false,
    outDir: "../dist/apps",
    rollupOptions: {
      input: "search-results.html",
    },
  },
});
