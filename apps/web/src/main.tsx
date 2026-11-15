import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { watchInstall } from "./runtime/install";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

watchInstall();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // a new version takes over by itself: no more "reload twice"
  registerSW({ immediate: true });
  // the hand-written worker of the previous versions kept its own cache
  void caches?.delete("trivela-v2").catch(() => undefined);
}
