import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { buildRealReplay, REPLAY_TOTAL_TIMEOUT_MS } from "../server/replay-service";
import type { ServerConfig } from "../server/config";
import {
  createTxlineClient,
  readResponseBodyLimited,
  TxlineRequestError,
} from "../server/txline-client";
import { startTxlineMock } from "./helpers/txline-mock";

function config(origin: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    apiOrigin: origin,
    guestJwt: "contract-jwt",
    apiToken: "txoracle_api_contract_only",
    fixtureId: "18241006",
    startEpochDay: 20649,
    timeoutMs: 500,
    rpcUrl: "http://127.0.0.1:8899",
    nodeEnv: "test",
    ...overrides,
  };
}

const verifiedView = async () => ({
  valid: true,
  epochDay: 20649,
  dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
  proofTargetTs: 1784143500000,
});

describe("authenticated TxLINE vertical slice", () => {
  it("keeps the production replay deadline fixed at 12 seconds", () => {
    expect(REPLAY_TOTAL_TIMEOUT_MS).toBe(12_000);
  });

  it("rejects redirects before any credential can reach a cross-origin sink", async () => {
    const sinkRequests: Array<{ authorization?: string; apiToken?: string }> = [];
    const sink = createServer((request, response) => {
      sinkRequests.push({
        authorization: request.headers.authorization,
        apiToken: request.headers["x-api-token"] as string | undefined,
      });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ reached: true }));
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const sinkAddress = sink.address();
    if (!sinkAddress || typeof sinkAddress === "string") throw new Error("Redirect sink did not bind.");

    const redirector = createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("Location", `http://127.0.0.1:${sinkAddress.port}/credential-sink`);
      response.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
    const redirectAddress = redirector.address();
    if (!redirectAddress || typeof redirectAddress === "string") throw new Error("Redirect server did not bind.");

    try {
      const client = createTxlineClient(config(`http://127.0.0.1:${redirectAddress.port}`));
      let caught: unknown;
      try {
        await client.get("/fixtures/snapshot", "fixtures_snapshot");
      } catch (error) {
        caught = error;
      }
      expect(sinkRequests).toEqual([]);
      expect(caught).toMatchObject({
        code: "TXLINE_REDIRECT_REJECTED",
        upstreamStatus: null,
      });
    } finally {
      await Promise.all([redirector, sink].map((server) => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      })));
    }
  });

  it("uses all five endpoint calls and returns transformed real state", async () => {
    const upstream = await startTxlineMock();
    try {
      let proofExpectation: unknown;
      const replay = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: async (_raw, expectation) => {
          proofExpectation = expectation;
          return verifiedView();
        },
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      });
      expect(upstream.seen).toHaveLength(12);
      expect(upstream.seen.every((request) => request.authorization === "Bearer contract-jwt")).toBe(true);
      expect(upstream.seen.every((request) => request.apiToken === "txoracle_api_contract_only")).toBe(true);
      expect(upstream.seen.map((request) => request.path)).toEqual(expect.arrayContaining([
        "/api/fixtures/snapshot?startEpochDay=20649",
        "/api/scores/historical/18241006",
        "/api/odds/snapshot/18241006?asOf=1784141880000",
        "/api/odds/snapshot/18241006?asOf=1784142120000",
        "/api/odds/snapshot/18241006?asOf=1784142780000",
        "/api/odds/snapshot/18241006?asOf=1784143020000",
        "/api/odds/snapshot/18241006?asOf=1784143080000",
        "/api/odds/snapshot/18241006?asOf=1784143320000",
        "/api/odds/snapshot/18241006?asOf=1784143380000",
        "/api/odds/snapshot/18241006?asOf=1784143620000",
        "/api/odds/snapshot/18241006?asOf=1784149620000",
        "/api/scores/stat-validation?fixtureId=18241006&seq=4&statKeys=1,2",
      ]));
      expect(replay.source.mode).toBe("real_txline");
      expect(replay.match.participant1.name).toBe("Azul Teste");
      expect(replay.events[1].score).toEqual({ participant1: 1, participant2: 0 });
      expect(replay.events.find(({ seq }) => seq === 4)?.score).toEqual({ participant1: 1, participant2: 2 });
      expect(replay.goalPulses.map(({ eventSeq }) => eventSeq)).toEqual([1, 2, 3, 4, 5]);
      expect(replay.goalPulses.find(({ eventSeq }) => eventSeq === 2)?.movement).toMatchObject({
        before: { pct: 41.2 },
        after: { pct: 64.7 },
        deltaPercentagePoints: 23.5,
      });
      const pulseSeries = replay.goalPulses.map(({ signal }) => signal?.tuple);
      expect(new Set(pulseSeries.map((tuple) => JSON.stringify(tuple)))).toHaveLength(1);
      expect(pulseSeries[0]).toEqual({
        bookmakerId: "77",
        superOddsType: "1X2_PARTICIPANT_RESULT",
        marketPeriod: null,
        marketParameters: null,
      });
      expect(replay.goalPulses.every(({ signal }) => signal !== undefined)).toBe(true);
      expect(replay.turningPoint).toMatchObject({ eventSeq: 4, minute: 91 });
      expect(replay.turningPoint?.movement.before.pct).toBe(12.9);
      expect(replay.turningPoint?.movement.after.pct).toBe(88.7);
      expect(replay.provenance.state).toBe("verified");
      expect(replay.provenance.epochDay).toBe(20649);
      expect(replay.provenance.dailyScoresPda).toBe("HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX");
      expect(replay.provenance.proofTargetTs).toBe(1784143500000);
      expect(replay.provenance.checkedAt).toBe("2026-07-17T12:00:00.000Z");
      expect(proofExpectation).toEqual({
        fixtureId: "18241006",
        seq: 4,
        eventTs: 1784143500000,
        statKeys: [1, 2],
        score: { participant1: 1, participant2: 2 },
      });
      const serialized = JSON.stringify(replay);
      expect(serialized).not.toContain("contract-jwt");
      expect(serialized).not.toContain("txoracle_api_contract_only");
      expect(serialized).not.toContain("subTreeProof");
      expect(serialized).not.toContain("eventStatRoot");
    } finally {
      await upstream.close();
    }
  });

  it("normalizes the finite SSE framing returned by live scores historical", async () => {
    const upstream = await startTxlineMock({ scoresAsSse: true });
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: verifiedView,
      });
      expect(replay.events).toHaveLength(5);
      expect(replay.events[1]).toMatchObject({ seq: 2, action: "goal" });
      expect(replay.source.endpoints.find(({ id }) => id === "scores_historical")?.status).toBe(200);
    } finally {
      await upstream.close();
    }
  });

  it("retries a transient 5xx exactly once", async () => {
    const path = "/api/fixtures/snapshot?startEpochDay=20649";
    const upstream = await startTxlineMock({ failFirstPath: path });
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", { verifyProof: verifiedView });
      expect(replay.source.mode).toBe("real_txline");
      expect(upstream.seen.filter((request) => request.path === path)).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });

  it("keeps a comparable turning point when the previous event supplies its before snapshot", async () => {
    const path = "/api/odds/snapshot/18241006?asOf=1784143380000";
    const upstream = await startTxlineMock({ responseStatusByPath: { [path]: 503 } });
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", { verifyProof: verifiedView });
      expect(replay.events.length).toBeGreaterThan(0);
      expect(replay.turningPoint).not.toBeNull();
      expect(replay.turningPoint?.movement.before.ts).toBe(1784143320000);
      expect(replay.turningPointReason).toBeNull();
      expect(replay.provenance.state).toBe("verified");
      expect(replay.source.endpoints.find(({ id }) => id === "odds_before")?.status).toBe(503);
      expect(upstream.seen.filter((request) => request.path === path)).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });

  it("keeps the timeline when both odds snapshots time out", async () => {
    const beforePath = "/api/odds/snapshot/18241006?asOf=1784143380000";
    const afterPath = "/api/odds/snapshot/18241006?asOf=1784143620000";
    const upstream = await startTxlineMock({
      delayMsByPath: { [beforePath]: 30, [afterPath]: 30 },
    });
    try {
      const replay = await buildRealReplay(
        config(upstream.origin, { timeoutMs: 10 }),
        "18241006",
        { verifyProof: verifiedView },
      );
      expect(replay.events.length).toBeGreaterThan(0);
      expect(replay.turningPoint).toBeNull();
      expect(replay.turningPointReason).toBe("odds_unavailable");
      expect(replay.provenance.state).toBe("verified");
      expect(upstream.seen.filter(({ path }) => path === beforePath)).toHaveLength(2);
      expect(upstream.seen.filter(({ path }) => path === afterPath)).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });

  it("returns the score timeline when the total deadline expires during odds", async () => {
    const beforePath = "/api/odds/snapshot/18241006?asOf=1784143380000";
    const afterPath = "/api/odds/snapshot/18241006?asOf=1784143620000";
    const upstream = await startTxlineMock({
      delayMsByPath: { [beforePath]: 100, [afterPath]: 100 },
    });
    const started = Date.now();
    try {
      const replay = await buildRealReplay(
        config(upstream.origin, { timeoutMs: 500 }),
        "18241006",
        { totalTimeoutMs: 30, verifyProof: verifiedView },
      );
      expect(Date.now() - started).toBeLessThan(250);
      expect(replay.events.length).toBeGreaterThan(0);
      expect(replay.turningPointReason).toBe("odds_unavailable");
      expect(replay.provenance).toMatchObject({ state: "unavailable", reason: "proof_timeout" });
    } finally {
      await upstream.close();
    }
  });

  it("aborts an initial TxLINE request at the one total replay deadline", async () => {
    let attempts = 0;
    let aborted = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          aborted += 1;
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    }) as typeof fetch;
    const started = Date.now();

    await expect(buildRealReplay(
      config("https://txline.invalid", { timeoutMs: 500 }),
      "18241006",
      { fetchImpl, totalTimeoutMs: 30, verifyProof: verifiedView },
    )).rejects.toMatchObject({ code: "TXLINE_TIMEOUT" });

    expect(Date.now() - started).toBeLessThan(250);
    expect(attempts).toBe(1);
    expect(aborted).toBe(1);
  });

  it.each([401, 403])("fails closed on upstream auth status %s", async (status) => {
    const upstream = await startTxlineMock({ responseStatus: status });
    try {
      await expect(buildRealReplay(config(upstream.origin), "18241006", { verifyProof: verifiedView }))
        .rejects.toMatchObject({ code: "TXLINE_AUTH_FAILED", upstreamStatus: status });
    } finally {
      await upstream.close();
    }
  });

  it("fails closed after two upstream 5xx responses", async () => {
    const upstream = await startTxlineMock({ responseStatus: 503 });
    try {
      await expect(buildRealReplay(config(upstream.origin), "18241006", { verifyProof: verifiedView }))
        .rejects.toMatchObject({ code: "TXLINE_UPSTREAM_STATUS", upstreamStatus: 503 });
      expect(upstream.seen).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });

  it("times out, retries once, and exposes no credential in the error", async () => {
    const upstream = await startTxlineMock({ delayMs: 80 });
    try {
      let caught: unknown;
      try {
        await buildRealReplay(config(upstream.origin, { timeoutMs: 10 }), "18241006", { verifyProof: verifiedView });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TxlineRequestError);
      expect(caught).toMatchObject({ code: "TXLINE_TIMEOUT" });
      expect(String(caught)).not.toContain("contract-jwt");
      expect(upstream.seen).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });
});

describe("bounded TxLINE response bodies", () => {
  it("retries a timeout after HTTP 200 headers and records 200 only after parsing", async () => {
    let attempts = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          signal?.addEventListener("abort", () => {
            streamController.error(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createTxlineClient(config("https://txline.invalid", { timeoutMs: 10 }), fetchImpl);

    await expect(client.get("/fixtures/snapshot", "fixtures_snapshot")).rejects.toMatchObject({
      code: "TXLINE_TIMEOUT",
      upstreamStatus: 200,
    });
    expect(attempts).toBe(2);
    expect(client.evidence.some(({ status }) => status === 200)).toBe(false);
  });

  it("counts streamed bytes and cancels before rejecting an oversized body", async () => {
    const events: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("1234"));
        streamController.enqueue(new TextEncoder().encode("5678"));
      },
      cancel() {
        events.push("cancel");
      },
    });
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => events.push("abort"));
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(readResponseBodyLimited(response, controller, 6)).rejects.toMatchObject({
      code: "TXLINE_RESPONSE_TOO_LARGE",
    });
    expect(events).toEqual(["cancel", "abort"]);
    expect(controller.signal.aborted).toBe(true);
  });

  it("rejects an oversized declared JSON body without reading it", async () => {
    const events: string[] = [];
    let requestSignal: AbortSignal | null = null;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      events.push("fetch");
      requestSignal = init?.signal ?? null;
      requestSignal?.addEventListener("abort", () => events.push("abort"));
      return new Response(new ReadableStream({ cancel: () => { events.push("cancel"); } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(16 * 1024 * 1024 + 1),
        },
      });
    }) as typeof fetch;
    const client = createTxlineClient(config("https://txline.invalid"), fetchImpl);

    await expect(client.get("/fixtures/snapshot", "fixtures_snapshot")).rejects.toMatchObject({
      code: "TXLINE_RESPONSE_TOO_LARGE",
      upstreamStatus: 200,
    });
    expect(events).toEqual(["fetch", "cancel", "abort"]);
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("cancels each 5xx body before retrying or throwing", async () => {
    const events: string[] = [];
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt += 1;
      const currentAttempt = attempt;
      events.push(`fetch-${currentAttempt}`);
      return new Response(new ReadableStream({
        cancel: () => { events.push(`cancel-${currentAttempt}`); },
      }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createTxlineClient(config("https://txline.invalid"), fetchImpl);

    await expect(client.get("/fixtures/snapshot", "fixtures_snapshot")).rejects.toMatchObject({
      code: "TXLINE_UPSTREAM_STATUS",
      upstreamStatus: 503,
    });
    expect(events).toEqual(["fetch-1", "cancel-1", "fetch-2", "cancel-2"]);
  });
});
