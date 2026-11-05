/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Deploy script sets CONQUEST_BASE (e.g. "/Conquest/") for subdirectory hosting.
  base: process.env.CONQUEST_BASE ?? "/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ["three"], react: ["react", "react-dom", "zustand"] } } },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
