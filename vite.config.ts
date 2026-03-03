import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for kAIxU Super IDE vNext.
// Specifies that React should be transpiled and sets a consistent dev port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});