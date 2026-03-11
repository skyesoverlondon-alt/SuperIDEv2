import React from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/browser";
import { App } from "./App";
import "./styles.css";

Sentry.init({
  dsn: "https://0b2e561e024543393c3f4a2cc7a56331@o4510973122838528.ingest.us.sentry.io/4510973134045184",
  sendDefaultPii: true,
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
