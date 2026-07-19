import { describe, expect, it } from "vitest";
import { computeViradaIndex, viradaTier } from "../src/virada-index";
import type { ReplayEnvelope, ReplayEvent, TurningPoint } from "../src/types";

const baseEvent = (overrides: Partial<ReplayEvent>): ReplayEvent => ({
  id: `event-${overrides.seq ?? 0}`,
  fixtureId: "18241006",
  seq: overrides.seq ?? 0,
  ts: overrides.ts ?? 0,
  action: overrides.action ?? "goal",
  minute: overrides.minute ?? null,
  participantId: overrides.participantId ?? null,
  participantName: overrides.participantName ?? null,
  phase: overrides.phase ?? null,
  score: overrides.score ?? null,
  corrected: false,
  playbackMs: overrides.playbackMs ?? 0,
});

describe("Virada Index", () => {
  it("scores the England–Argentina comeback as 92/100 Legendary", () => {
    const events = [
      baseEvent({ seq: 540, ts: 1_000_000, minute: 54, playbackMs: 8_000, participantName: "England", score: { participant1: 1, participant2: 0 } }),
      baseEvent({ seq: 831, ts: 2_800_000, minute: 84, playbackMs: 14_000, participantName: "Argentina", score: { participant1: 1, participant2: 1 } }),
      baseEvent({ seq: 871, ts: 3_220_000, minute: 91, playbackMs: 16_000, participantName: "Argentina", score: { participant1: 1, participant2: 2 } }),
    ];
    const turningPoint: TurningPoint = {
      ...events[2],
      eventSeq: 871,
      eventTs: 3_220_000,
      movement: {
        tuple: {
          bookmakerId: "10021",
          superOddsType: "1X2_PARTICIPANT_RESULT",
          marketPeriod: null,
          marketParameters: null,
          priceName: "part2",
        },
        before: { ts: 3_100_000, pct: 12.989 },
        after: { ts: 3_340_000, pct: 88.652 },
        deltaPercentagePoints: 75.663,
        direction: "up",
      },
    };
    const replay = {
      events,
      turningPoint,
      match: {
        participant1: { id: "eng", name: "England", side: "participant1" },
        participant2: { id: "arg", name: "Argentina", side: "participant2" },
      },
    } as Pick<ReplayEnvelope, "events" | "turningPoint" | "match">;

    expect(computeViradaIndex(replay)).toEqual({
      total: 92,
      tier: "legendary",
      components: {
        scoreImportance: 30,
        lateness: 25,
        comebackSpeed: 12,
        txlineShock: 25,
      },
    });
  });

  it("uses the strict 60/70/80/90 tier boundaries", () => {
    expect(viradaTier(59)).toBe("standard");
    expect(viradaTier(60)).toBe("classic");
    expect(viradaTier(70)).toBe("rare");
    expect(viradaTier(80)).toBe("epic");
    expect(viradaTier(90)).toBe("legendary");
  });
});
