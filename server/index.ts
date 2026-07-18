import type { Connect } from "vite";
import { createTorcidaServer } from "./app.js";
import { readServerConfig } from "./config.js";

const config = readServerConfig();
const dev = process.argv.includes("--dev");
let middleware: Connect.Server | undefined;
if (dev) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  middleware = vite.middlewares;
}
const server = createTorcidaServer(config, {}, middleware);
server.listen(config.port, () => {
  process.stdout.write(`Torcida Pulse listening on port ${config.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
