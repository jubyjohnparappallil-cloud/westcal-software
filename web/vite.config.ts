import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.BACKEND_URL ?? "http://localhost:3000";
const proxied = ["/api", "/logo.jpg", "/public", "/verify", "/certificate-"];

/** The field app (/m) and trainee join pages are part of this React app; serve them from the dev server too. */
function devPageRedirects(): Plugin {
  return {
    name: "dev-page-redirects",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (/^\/(m|mobile)\/?(\?|$)/.test(url) || /^\/join\//.test(url)) {
          res.statusCode = 302;
          res.setHeader("Location", "/app" + url);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: "/app/",
  plugins: [react(), devPageRedirects()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: backend, changeOrigin: true }])),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
