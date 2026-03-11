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
  }
});