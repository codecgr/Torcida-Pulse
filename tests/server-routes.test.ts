import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTorcidaServer,
  type DiagnosticLogger,
  type ServerDiagnostic,
} from "../server/app";
import type { ServerConfig } from "../server/config";
import type { ReplayDependencies } from "../server/replay-service";
import { TxlineRequestError } from "../server/txline-client";

const servers: ReturnType<typeof createTorcidaServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(
  overrides: Partial<ServerConfig> = {},
  dependencies: ReplayDependencies = {},
  logDiagnostic: DiagnosticLogger = () => undefined
) {
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
  const server = createTorcidaServer(config, dependencies, undefined, logDiagnostic);
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

  it("logs allowlisted diagnostics without exposing exception, headers, env, proof, or payload", async () => {
    const diagnostics: ServerDiagnostic[] = [];
    const secretMessage = "payload proof authorization bearer txoracle_api_do_not_log";
    const origin = await start(
      {},
      { now: () => { throw new Error(secretMessage); } },
      (diagnostic) => diagnostics.push(diagnostic)
    );
    const response = await fetch(`${origin}/api/demo?guestJwt=also-do-not-log`, {
      headers: { Authorization: "Bearer header-do-not-log" },
    });
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(500);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      requestId,
      route: "/api/demo",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(diagnostics[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics[0].stack.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(diagnostics[0]).toLowerCase();
    for (const forbidden of [
      "do_not_log",
      "do-not-log",
      "authorization",
      "guestjwt",
      "payload",
      "proof",
      "bearer",
      "/home/",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("replaces unknown diagnostic status and code with allowlisted values", async () => {
    const diagnostics: ServerDiagnostic[] = [];
    const origin = await start(
      { guestJwt: "test-jwt", apiToken: "txoracle_api_test_only" },
      {
        fetchImpl: (async () => {
          throw new TxlineRequestError("UNREVIEWED_CODE", "Internal-only test error.", 418);
        }) as typeof fetch,
      },
      (diagnostic) => diagnostics.push(diagnostic)
    );

    expect((await fetch(`${origin}/api/replays/18241006`)).status).toBe(418);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      route: "/api/replays/:fixtureId",
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });
});
