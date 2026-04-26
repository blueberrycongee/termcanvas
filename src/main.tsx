import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
// Install `self.MonacoEnvironment` before any Monaco instance mounts.
// Side-effect import — by the time the drawer (lazy-loaded) opens,
// Monaco reads this env synchronously.
import "./monacoEnvironment";
import "./scrollFade";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
