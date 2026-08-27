import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

/* Stamp the build into the app. Without it there is no way to tell a fix that
   is not deployed from a fix that does not work, and both look identical from
   the browser. Vercel exposes the commit it built; locally, ask git. */
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA
  || (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); }
              catch { return "dev"; } })();

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(String(BUILD).slice(0,7)) },
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
