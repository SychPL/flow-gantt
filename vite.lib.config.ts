import { defineConfig } from "vite";

// Library build: three ESM entries, React and its JSX runtime stay external.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: { index: "src/index.ts", layout: "src/layout/index.ts", ops: "src/ops/index.ts" },
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/],
    },
  },
});
