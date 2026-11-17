import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Strict CSP used by the preview server; the browser tests run against the production build (AT-X9).
const csp = "default-src 'self'; style-src 'self'; script-src 'self'";

export default defineConfig({
  root: "demo",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, modulePreload: { polyfill: false } },
  preview: { headers: { "Content-Security-Policy": csp } },
});
