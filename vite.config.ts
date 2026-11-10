import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Serve ./data (bars, scans, backtests written by the CLI) at /data in dev and preview. */
function serveData(): Plugin {
  const root = join(import.meta.dirname, "data");
  const handler = (req: any, res: any, next: any) => {
    const url = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (!url.startsWith("/data/")) return next();
    const file = normalize(join(root, url.slice(6)));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-cache");
    createReadStream(file).pipe(res);
  };
  // Dev only: the page can POST a PNG of the chart canvas here so a reading can be reviewed at full resolution.
  const shot = (req: any, res: any, next: any) => {
    if (req.method !== "POST" || !(req.url ?? "").startsWith("/__shot")) return next();
    const name = (new URL(req.url, "http://x").searchParams.get("name") ?? "shot").replace(/[^A-Za-z0-9._-]/g, "_");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      mkdirSync(join(root, "shots"), { recursive: true });
      writeFileSync(join(root, "shots", name + ".png"), Buffer.concat(chunks));
      res.end("ok");
    });
  };
  return {
    name: "serve-data",
    configureServer: (s) => {
      s.middlewares.use(shot);
      s.middlewares.use(handler);
    },
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), serveData()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
});
