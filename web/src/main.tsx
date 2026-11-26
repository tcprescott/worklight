import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { loadConfig } from "./config";
import { registerServiceWorker } from "./lib/push";

const root = createRoot(document.getElementById("root")!);

loadConfig()
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((err: Error) => root.render(<p className="page error">{err.message}</p>));

// Push notifications arrive through the service worker, so it is registered on every visit.
window.addEventListener("load", () => void registerServiceWorker()?.catch(() => undefined));
