import { describe, expect, it } from "vitest";
import { ProofTimeoutError, ProofUnavailableError } from "../server/proof";
import { buildRealReplay, loadSyntheticReplay } from "../server/replay-service";
import type { ServerConfig } from "../server/config";
import { startTxlineMock } from "./helpers/txline-mock";

function config(origin: string): ServerConfig {
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
  };
}

describe("truthful provenance state machine", () => {
  it("uses failed when validateStatV2 view rejects or throws", async () => {
    const upstream = await startTxlineMock();
    try {
      const rejected = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: async () => ({
          valid: false,
          epochDay: 20649,
          dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
          proofTargetTs: 1784143500000,
        }),
      });
      expect(rejected.provenance.state).toBe("failed");
      expect(rejected.provenance.reason).toBe("onchain_view_rejected");
    } finally {
      await upstream.close();
    }

    const upstream2 = await startTxlineMock();
    try {
      const thrown = await buildRealReplay(config(upstream2.origin), "18241006", {
        verifyProof: async () => { throw new Error("fictional simulation failure"); },
      });
      expect(thrown.provenance.state).toBe("failed");
      expect(thrown.provenance.reason).toBe("onchain_view_failed");
    } finally {
      await upstream2.close();
    }
  });

  it("uses unavailable for an unusable proof shape, never verified", async () => {
    const upstream = await startTxlineMock();
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: async () => { throw new ProofUnavailableError("fictional shape failure"); },
      });
      expect(replay.provenance.state).toBe("unavailable");
      expect(replay.provenance.epochDay).toBeNull();
    } finally {
      await upstream.close();
    }
  });

  it("uses unavailable when proof validation times out", async () => {
    const upstream = await startTxlineMock();
    try {
      const replay = await buildRealReplay(config(upstream.origin), "18241006", {
        verifyProof: async () => { throw new ProofTimeoutError("fictional timeout"); },
      });
      expect(replay.provenance).toMatchObject({ state: "unavailable", reason: "proof_timeout" });
    } finally {
      await upstream.close();
    }
  });

  it("uses unavailable when the proof endpoint itself times out", async () => {
    const validationPath = "/api/scores/stat-validation?fixtureId=18241006&seq=4&statKeys=1,2";
    const upstream = await startTxlineMock({ delayMsByPath: { [validationPath]: 30 } });
    try {
      const replay = await buildRealReplay(
        { ...config(upstream.origin), timeoutMs: 10 },
        "18241006",
        { verifyProof: async () => { throw new Error("verifier must not run"); } },
      );
      expect(replay.provenance).toMatchObject({ state: "unavailable", reason: "proof_timeout" });
      expect(upstream.seen.filter(({ path }) => path === validationPath)).toHaveLength(2);
    } finally {
      await upstream.close();
    }
  });

  it("keeps the fictional route synthetic_unverified with no program claim", async () => {
    const replay = await loadSyntheticReplay(() => new Date("2026-07-17T00:00:00.000Z"));
    expect(replay.source.mode).toBe("synthetic");
    expect(replay.provenance.state).toBe("synthetic_unverified");
    expect(replay.provenance.programId).toBeNull();
    expect(replay.provenance.dailyScoresPda).toBeNull();
    expect(replay.provenance.proofTargetTs).toBeNull();
    expect(replay.source.endpoints).toEqual([]);
  });
});
