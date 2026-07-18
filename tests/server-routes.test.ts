import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createTorcidaServer } from "../server/app";
import type { ServerConfig } from "../server/config";

const servers: ReturnType<typeof createTorcidaServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(overrides: Partial<ServerConfig> = {}) {
  const config: ServerConfig = {
    port: 0,
    apiOrigin: "http://127.0.0.1:1",
    guestJwt: null,
    apiToken: null,
    fixtureId: "18241006",
    startEpochDay: 20649,
    timeoutMs: 50,
    rpcUrl: "http://127.0.0.1:8899",
    nodeEnv: "test",
    ...overrides,
  };
  const server = createTorcidaServer(config);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("judge-facing server routes", () => {
  it("fails the real route closed when credentials are missing", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/api/replays/18241006`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "TXLINE_CREDENTIALS_MISSING",
        message: "TxLINE devnet credentials are not configured on the server.",
        upstreamStatus: null,
      },
    });
  });

  it("serves fictional data only on its explicit route with synthetic state", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/api/demo`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(body.source.mode).toBe("synthetic");
    expect(body.provenance.state).toBe("synthetic_unverified");
  });

  it("does not become a general TxLINE proxy", async () => {
    const origin = await start();
    expect((await fetch(`${origin}/api/replays/99999999`)).status).toBe(404);
    expect((await fetch(`${origin}/api/unknown`)).status).toBe(404);
    expect((await fetch(`${origin}/api/demo`, { method: "POST" })).status).toBe(405);
  });
});
