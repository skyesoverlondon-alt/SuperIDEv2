import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for kAIxU Super IDE vNext.
// Specifies that React should be transpiled and sets a consistent dev port.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8888";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: false,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@monaco-editor") || id.includes("monaco-editor")) return "monaco-vendor";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          if (id.includes("@sentry")) return "sentry-vendor";
          if (id.includes("three")) return "three-vendor";
          return "vendor";
        },
      },
    },
  },
});