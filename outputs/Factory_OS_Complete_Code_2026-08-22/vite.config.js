import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/ui/setup.js"],
    include: ["tests/ui/**/*.test.jsx", "tests/api/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}", "api/**/*.js"],
      exclude: ["src/main.jsx", "api/_lib/db.js"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 35, statements: 35, branches: 40, functions: 25 },
    },
  },
});
