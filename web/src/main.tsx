import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { loadConfig } from "./config";

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
