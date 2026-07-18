import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FROZEN_FIXTURE_ID,
  REPLAY_CONTRACT,
  assertReplayEnvelopeContract,
} from "../src/replay-contract";

function fictionalFixture(): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/fictional-test-scenario.json"), "utf8"));
}

describe("shared replay contract", () => {
  it("owns the frozen fixture and validates the synthetic fixture timing", () => {
    const replay = fictionalFixture();
    expect(() => assertReplayEnvelopeContract(replay)).not.toThrow();
    expect(FROZEN_FIXTURE_ID).toBe("18241006");
    expect((replay as { playbackDurationMs: number }).playbackDurationMs).toBe(REPLAY_CONTRACT.playbackDurationMs);
  });

  it("rejects a synthetic fixture that drifts from the playback contract", () => {
    const replay = fictionalFixture() as { playbackDurationMs: number };
    replay.playbackDurationMs -= 1;
    expect(() => assertReplayEnvelopeContract(replay)).toThrow(/playbackDurationMs/);
  });

  it("requires a truthful reason exactly when the turning point is absent", () => {
    const withMoment = fictionalFixture() as { turningPointReason: string | null };
    withMoment.turningPointReason = "odds_unavailable";
    expect(() => assertReplayEnvelopeContract(withMoment)).toThrow(/cannot include/);

    const withoutMoment = fictionalFixture() as { turningPoint: unknown; turningPointReason: string | null };
    withoutMoment.turningPoint = null;
    withoutMoment.turningPointReason = null;
    expect(() => assertReplayEnvelopeContract(withoutMoment)).toThrow(/must explain/);
    withoutMoment.turningPointReason = "odds_unavailable";
    expect(() => assertReplayEnvelopeContract(withoutMoment)).not.toThrow();
  });
});
