import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTorcidaServer,
  type AppDependencies,
  type DiagnosticLogger,
  type ServerDiagnostic,
} from "../server/app";
import type { ServerConfig } from "../server/config";
import { TxlineRequestError } from "../server/txline-client";
import { startTxlineMock } from "./helpers/txline-mock";

const servers: ReturnType<typeof createTorcidaServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function start(
  overrides: Partial<ServerConfig> = {},
  dependencies: AppDependencies = {},
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
  it("publishes a narrow TxLINE World Cup catalog with the live final first", async () => {
    const upstream = await startTxlineMock();
    try {
      const origin = await start({
        apiOrigin: upstream.origin,
        guestJwt: "contract-jwt",
        apiToken: "txoracle_api_contract_only",
      }, { now: () => new Date("2026-07-19T19:05:00.000Z") });
      const response = await fetch(`${origin}/api/fixtures`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        source: "TxLINE",
        fetchedAt: "2026-07-19T19:05:00.000Z",
        competition: "World Cup",
        fixtures: [{
          fixtureId: "18257739",
          competition: "World Cup",
          startTime: 1784487600000,
          participant1: "Spain",
          participant2: "Argentina",
          status: "live",
        }],
      });
    } finally {
      await upstream.close();
    }
  });

  it("serves stable public metadata for the real collectible", async () => {
    const origin = await start({ publicAppOrigin: "https://pulse.example" });
    const response = await fetch(`${origin}/api/collectibles/legendary-91/metadata`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Torcida Pulse — A Virada Depois da Virada",
      symbol: "TPULSE",
      image: "https://pulse.example/legendary-turning-point.webp",
      attributes: expect.arrayContaining([
        { trait_type: "Rarity", value: "Legendary" },
        { trait_type: "Artwork", value: "Pre-generated generative AI example" },
      ]),
    });
  });

  it("mints a real collectible once for an idempotent premium claim", async () => {
    const upstream = await startTxlineMock();
    let mintCalls = 0;
    try {
      const collectible = {
        network: "devnet" as const,
        standard: "Metaplex Core" as const,
        assetAddress: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
        ownerAddress: "AMoP5pTLuFRioTrLUgwWt3sBYF4RAJNLVXy8D6BQtdW8",
        signature: "4".repeat(88),
        metadataUri: "https://pulse.example/api/collectibles/legendary-91/metadata",
        explorerAssetUrl: "https://explorer.solana.com/address/HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX?cluster=devnet",
        explorerTransactionUrl: `https://explorer.solana.com/tx/${"4".repeat(88)}?cluster=devnet`,
      };
      const origin = await start({
        apiOrigin: upstream.origin,
        guestJwt: "contract-jwt",
        apiToken: "txoracle_api_contract_only",
        publicAppOrigin: "https://pulse.example",
      }, {
        verifyProof: async () => ({
          valid: true,
          epochDay: 20649,
          dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
          proofTargetTs: 1784143500000,
        }),
        now: () => new Date("2026-07-17T12:00:00.000Z"),
        mintCollectible: async (metadataUri) => {
          mintCalls += 1;
          expect(metadataUri).toBe(collectible.metadataUri);
          return collectible;
        },
      });
      const options = {
        method: "POST",
        headers: { "Idempotency-Key": "judge-legendary-claim-0001" },
      };
      const first = await fetch(`${origin}/api/collectibles/legendary-91/claim`, options);
      const second = await fetch(`${origin}/api/collectibles/legendary-91/claim`, options);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((await first.json())).toEqual({ collectible });
      expect((await second.json())).toEqual({ collectible });
      expect(mintCalls).toBe(1);
    } finally {
      await upstream.close();
    }
  });

  it("separates process liveness from real replay readiness", async () => {
    const origin = await start();
    const live = await fetch(`${origin}/api/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "live" });

    const ready = await fetch(`${origin}/api/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      status: "not_ready",
      reason: "TXLINE_CREDENTIALS_MISSING",
    });
  });

  it("prewarms once, shares concurrent work, and caches only the normalized replay", async () => {
    const upstream = await startTxlineMock();
    try {
      const origin = await start(
        {
          apiOrigin: upstream.origin,
          guestJwt: "contract-jwt",
          apiToken: "txoracle_api_contract_only",
          replayCacheTtlMs: 60_000,
        },
        {
          verifyProof: async () => ({
            valid: true,
            epochDay: 20649,
            dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
            proofTargetTs: 1784143500000,
          }),
          now: () => new Date("2026-07-17T12:00:00.000Z"),
        }
      );
      const [first, second] = await Promise.all([
        fetch(`${origin}/api/replays/18241006`),
        fetch(`${origin}/api/replays/18241006`),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(upstream.seen).toHaveLength(12);

      const cached = await fetch(`${origin}/api/replays/18241006`);
      expect(cached.status).toBe(200);
      expect(upstream.seen).toHaveLength(12);
      expect((await fetch(`${origin}/api/replays/99999999`)).status).toBe(404);
      expect(upstream.seen).toHaveLength(13);
      expect(upstream.seen[upstream.seen.length - 1]?.path).toBe("/api/fixtures/snapshot?startEpochDay=20615");
      expect(await (await fetch(`${origin}/api/ready`)).json()).toMatchObject({ status: "ready" });
      const body = await cached.text();
      expect(body).not.toContain("contract-jwt");
      expect(body).not.toContain("txoracle_api_contract_only");
      expect(body).not.toContain("subTreeProof");
    } finally {
      await upstream.close();
    }
  });

  it("stays not-ready when TxLINE rejects configured credentials", async () => {
    const upstream = await startTxlineMock({ responseStatus: 401 });
    try {
      const origin = await start({
        apiOrigin: upstream.origin,
        guestJwt: "contract-jwt",
        apiToken: "txoracle_api_contract_only",
      });
      const replay = await fetch(`${origin}/api/replays/18241006`);
      expect(replay.status).toBe(502);
      const ready = await fetch(`${origin}/api/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ status: "not_ready", reason: "TXLINE_AUTH_FAILED" });
    } finally {
      await upstream.close();
    }
  });

  it("rate-limits the authorized real replay route without another upstream build", async () => {
    const upstream = await startTxlineMock();
    try {
      const origin = await start(
        {
          apiOrigin: upstream.origin,
          guestJwt: "contract-jwt",
          apiToken: "txoracle_api_contract_only",
          replayRateLimitMax: 1,
          replayRateLimitWindowMs: 60_000,
        },
        {
          verifyProof: async () => ({
            valid: true,
            epochDay: 20649,
            dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
            proofTargetTs: 1784143500000,
          }),
        }
      );
      expect((await fetch(`${origin}/api/replays/18241006`)).status).toBe(200);
      const limited = await fetch(`${origin}/api/replays/18241006`);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
      expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
      expect(upstream.seen).toHaveLength(12);
    } finally {
      await upstream.close();
    }
  });

  it("protects production real data with judge access and a shutdown window", async () => {
    const upstream = await startTxlineMock();
    try {
      const origin = await start(
        {
          nodeEnv: "production",
          apiOrigin: upstream.origin,
          guestJwt: "contract-jwt",
          apiToken: "txoracle_api_contract_only",
          judgeAccessToken: "judge-access-contract-only",
          realDataDisableAt: Date.parse("2026-07-20T03:00:00.000Z"),
        },
        {
          verifyProof: async () => ({
            valid: true,
            epochDay: 20649,
            dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
            proofTargetTs: 1784143500000,
          }),
          now: () => new Date("2026-07-18T12:00:00.000Z"),
        }
      );
      expect((await fetch(`${origin}/api/replays/18241006`)).status).toBe(401);
      expect((await fetch(`${origin}/api/replays/18241006`, {
        headers: { "X-Judge-Access": "wrong" },
      })).status).toBe(401);
      expect((await fetch(`${origin}/api/replays/18241006`, {
        headers: { "X-Judge-Access": "judge-access-contract-only" },
      })).status).toBe(200);
    } finally {
      await upstream.close();
    }

    const expired = await start({
      nodeEnv: "production",
      guestJwt: "contract-jwt",
      apiToken: "txoracle_api_contract_only",
      judgeAccessToken: "judge-access-contract-only",
      realDataDisableAt: Date.parse("2026-07-18T11:59:59.000Z"),
    }, { now: () => new Date("2026-07-18T12:00:00.000Z") });
    const disabled = await fetch(`${expired}/api/replays/18241006`, {
      headers: { "X-Judge-Access": "judge-access-contract-only" },
    });
    expect(disabled.status).toBe(410);
    expect(await disabled.json()).toMatchObject({ error: { code: "REAL_DATA_DISABLED" } });
  });

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

  it("does not expose a demo-data route", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/api/demo`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("does not become a general TxLINE proxy", async () => {
    const origin = await start({
      guestJwt: "contract-jwt",
      apiToken: "txoracle_api_contract_only",
    }, {
      listFixtures: async () => ({
        source: "TxLINE",
        fetchedAt: "2026-07-19T19:05:00.000Z",
        competition: "World Cup",
        fixtures: [],
      }),
    });
    expect((await fetch(`${origin}/api/replays/99999999`)).status).toBe(404);
    expect((await fetch(`${origin}/api/unknown`)).status).toBe(404);
    expect((await fetch(`${origin}/api/demo`, { method: "POST" })).status).toBe(405);
  });

  it("logs allowlisted diagnostics without exposing exception, headers, env, proof, or payload", async () => {
    const diagnostics: ServerDiagnostic[] = [];
    const origin = await start(
      {},
      {},
      (diagnostic) => diagnostics.push(diagnostic)
    );
    const response = await fetch(`${origin}/bad-%E0%A4%A?guestJwt=also-do-not-log`, {
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
      route: "static",
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
