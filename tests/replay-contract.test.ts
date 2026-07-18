import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_REPLAY_FIXTURE_ID,
  REPLAY_CONTRACT,
  REPLAY_MANIFEST,
  assertReplayEnvelopeContract,
} from "../src/replay-contract";

function fictionalFixture(): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/fictional-test-scenario.json"), "utf8"));
}

describe("shared replay contract", () => {
  it("owns the active manifest fixture and validates the synthetic fixture timing", () => {
    const replay = fictionalFixture();
    expect(() => assertReplayEnvelopeContract(replay)).not.toThrow();
    expect(ACTIVE_REPLAY_FIXTURE_ID).toBe("18241006");
    expect(REPLAY_MANIFEST.startEpochDay).toBe(20649);
    expect((replay as { playbackDurationMs: number }).playbackDurationMs).toBe(REPLAY_CONTRACT.playbackDurationMs);
  });

  it("keeps the fictional fan demo as a genuine completed comeback", () => {
    const replay = fictionalFixture() as {
      events: Array<{ seq: number; score: { participant1: number | null; participant2: number | null } }>;
      turningPoint: { eventSeq: number; participantName: string };
    };
    const pointIndex = replay.events.findIndex((event) => event.seq === replay.turningPoint.eventSeq);
    expect(pointIndex).toBeGreaterThan(0);
    const before = replay.events[pointIndex - 1].score;
    const after = replay.events[pointIndex].score;
    expect(before).toEqual({ participant1: 1, participant2: 1 });
    expect(after).toEqual({ participant1: 2, participant2: 1 });
    expect(replay.turningPoint.participantName).toBe("Aurora FC");
  });

  it("rotates before the official two-week historical eligibility window ends", () => {
    const start = Date.parse(REPLAY_MANIFEST.fixtureStartTime);
    const eligibleAfter = Date.parse(REPLAY_MANIFEST.historicalEligibleAfter);
    const eligibleUntil = Date.parse(REPLAY_MANIFEST.historicalEligibleUntil);
    const rotateBefore = Date.parse(REPLAY_MANIFEST.rotateBefore);
    expect(eligibleAfter - start).toBe(6 * 60 * 60_000);
    expect(eligibleUntil - start).toBe(14 * 24 * 60 * 60_000);
    expect(rotateBefore).toBeLessThan(eligibleUntil);
    expect(eligibleUntil - rotateBefore).toBeGreaterThanOrEqual(24 * 60 * 60_000);
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
