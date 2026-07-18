import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createTorcidaServer } from "../server-dist/server/app.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(readFileSync(resolve(root, "config/replay-manifest.json"), "utf8"));
for (const required of ["dist/index.html", "server-dist/server/index.js", "vendor/txodds/devnet-txoracle.json", "fixtures/fictional-test-scenario.json"]) {
  if (!existsSync(resolve(root, required))) throw new Error(`SMOKE missing ${required}`);
}

const config = {
  port: 0,
  apiOrigin: "https://txline-dev.txodds.com",
  guestJwt: null,
  apiToken: null,
  fixtureId: manifest.fixtureId,
  startEpochDay: manifest.startEpochDay,
  timeoutMs: 100,
  rpcUrl: "https://api.devnet.solana.com",
  nodeEnv: "production",
};
const server = createTorcidaServer(config);
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("SMOKE server address unavailable");
const origin = `http://127.0.0.1:${address.port}`;
try {
  const page = await fetch(origin);
  const html = await page.text();
  if (page.status !== 200 || !html.includes("Torcida Pulse")) throw new Error("SMOKE production page failed");
  if (!page.headers.get("content-security-policy")?.includes("default-src 'self'")) throw new Error("SMOKE CSP missing");
  if (page.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive") throw new Error("SMOKE noindex header missing");

  const live = await (await fetch(`${origin}/api/live`)).json();
  if (live.status !== "live") throw new Error("SMOKE liveness contract failed");
  const readyResponse = await fetch(`${origin}/api/ready`);
  const ready = await readyResponse.json();
  if (readyResponse.status !== 503 || ready.reason !== "TXLINE_CREDENTIALS_MISSING") throw new Error("SMOKE readiness did not fail closed");

  const health = await (await fetch(`${origin}/api/health`)).json();
  if (health.status !== "ok" || health.rawPayloadsStored !== false || health.credentialsConfigured !== false) throw new Error("SMOKE health contract failed");

  const synthetic = await (await fetch(`${origin}/api/demo`)).json();
  if (synthetic.source.mode !== "synthetic" || synthetic.provenance.state !== "synthetic_unverified") throw new Error("SMOKE fictional route mislabeled");

  const realResponse = await fetch(`${origin}/api/replays/${manifest.fixtureId}`);
  const realError = await realResponse.json();
  if (realResponse.status !== 503 || realError.error?.code !== "TXLINE_CREDENTIALS_MISSING") throw new Error("SMOKE real route did not fail closed");

  const assets = readdirSync(resolve(root, "dist/assets"));
  const hashes = Object.fromEntries(["dist/index.html", ...assets.map((asset) => `dist/assets/${asset}`)].map((path) => {
    const bytes = readFileSync(resolve(root, path));
    return [path, createHash("sha256").update(bytes).digest("hex")];
  }));
  process.stdout.write(`SMOKE OK: production server, CSP/noindex, live/ready split, explicit synthetic mode, and fail-closed real route.\n${JSON.stringify(hashes, null, 2)}\n`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
