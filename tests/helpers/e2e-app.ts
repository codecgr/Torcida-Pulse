import { createTorcidaServer } from "../../server/app";
import { readServerConfig } from "../../server/config";

const config = readServerConfig();
const server = createTorcidaServer(config, {
  verifyProof: async () => ({ valid: true, epochDay: 20649 }),
  now: () => new Date("2026-07-17T12:00:00.000Z"),
});
server.listen(config.port, "127.0.0.1", () => process.stdout.write(`E2E app on ${config.port}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
