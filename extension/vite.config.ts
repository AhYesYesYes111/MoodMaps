import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    rollupOptions: {
      input: "sidepanel.html"
    }
  },
  server: {
    port: 5173
  }
});
