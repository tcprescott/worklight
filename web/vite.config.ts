import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` talks to a deployed stack: set VITE_API_PROXY to its CloudFront URL.
// `npm run dev:local` talks to dev/devserver.py on port 8787 and serves public/config.local.json.
const local = process.env.WORKLIGHT_LOCAL === "1";
const target = local ? `http://127.0.0.1:${process.env.WORKLIGHT_API_PORT ?? "8787"}` : process.env.VITE_API_PROXY;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "worklight-local-config",
      configureServer(server) {
        if (!local) return;
        server.middlewares.use("/config.json", (_req, res) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ region: "us-east-1", userPoolId: "local", userPoolClientId: "local", hostedUiUrl: null, googleEnabled: false, devAuth: true }));
        });
      },
    },
  ],
  server: {
    proxy: target ? { "/api": { target, changeOrigin: true } } : undefined,
  },
});
