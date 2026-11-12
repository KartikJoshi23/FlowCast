import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The forecasting engine (Python) runs in a module Web Worker through Pyodide, which is
// loaded at runtime from jsDelivr; nothing from Pyodide is bundled.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "netlify/**/*.test.ts"],
  },
});
