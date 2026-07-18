import { describe, expect, it } from "vitest";
import { buildRealReplay } from "../server/replay-service";
import type { ServerConfig } from "../server/config";
import { TxlineRequestError } from "../server/txline-client";
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

const verifiedView = async () => ({ valid: true, epochDay: 20649 });

describe("authenticated TxLINE vertical slice", () => {
  it("uses all five endpoint calls and returns transformed real state", async () => {
    const upstream = await startTxlineMock();
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: verifiedView,
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      });
      expect(upstream.seen).toHaveLength(5);
      expect(upstream.seen.every((request) => request.authorization === "Bearer contract-jwt")).toBe(true);
      expect(upstream.seen.every((request) => request.apiToken === "txoracle_api_contract_only")).toBe(true);
      expect(upstream.seen.map((request) => request.path)).toEqual(expect.arrayContaining([
        "/api/fixtures/snapshot?startEpochDay=20649",
        "/api/scores/historical/18241006",
        "/api/odds/snapshot/18241006?asOf=1784143380000",
        "/api/odds/snapshot/18241006?asOf=1784143620000",
        "/api/scores/stat-validation?fixtureId=18241006&seq=4&statKeys=1,2",
      ]));
      expect(replay.source.mode).toBe("real_txline");
      expect(replay.match.participant1.name).toBe("Azul Teste");
      expect(replay.events[1].score).toEqual({ participant1: 1, participant2: 0 });
      expect(replay.events.find(({ seq }) => seq === 4)?.score).toEqual({ participant1: 1, participant2: 2 });
      expect(replay.turningPoint).toMatchObject({ eventSeq: 4, minute: 91 });
      expect(replay.turningPoint?.movement.before.pct).toBe(12.9);
      expect(replay.turningPoint?.movement.after.pct).toBe(88.7);
      expect(replay.provenance.state).toBe("verified");
      expect(replay.provenance.epochDay).toBe(20649);
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
