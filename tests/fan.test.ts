import { describe, expect, it } from "vitest";
import { computeMarketPosition, fanRead, insightFanRead, pulseDisplayMovement } from "../src/fan";
import type { Team, TurningPoint } from "../src/types";

const p1: Team = { id: "a", name: "Aurora FC", side: "participant1" };
const p2: Team = { id: "b", name: "Vento Sul", side: "participant2" };

describe("computeMarketPosition", () => {
  const turningPoint: TurningPoint = {
    eventSeq: 871,
    eventTs: 1_000,
    playbackMs: 15_000,
    minute: 91,
    action: "goal",
    participantName: "Vento Sul",
    movement: {
      tuple: {
        bookmakerId: "7",
        superOddsType: "RETURNED_TYPE",
        marketPeriod: null,
        marketParameters: null,
        priceName: "Vento Sul",
      },
      before: { ts: 900, pct: 12.989 },
      after: { ts: 1_100, pct: 88.652 },
      deltaPercentagePoints: 75.663,
      direction: "up",
    },
  };

  it("uses the real returned odds on each side of the event instead of goal weights", () => {
    expect(computeMarketPosition(turningPoint, p1, p2, 14_999)?.share1).toBeCloseTo(87.011, 3);
    expect(computeMarketPosition(turningPoint, p1, p2, 15_000)?.share1).toBeCloseTo(11.348, 3);
  });

  it("uses the two-team normalized signal when the three-way market includes a draw", () => {
    const withSignal = structuredClone(turningPoint);
    withSignal.signal = {
      tuple: {
        bookmakerId: "7",
        superOddsType: "1X2_PARTICIPANT_RESULT",
        marketPeriod: null,
        marketParameters: null,
      },
      before: {
        ts: 900,
        participant1Pct: 69,
        participant2Pct: 12.989,
        participant1Share: 84.157,
      },
      after: {
        ts: 1_100,
        participant1Pct: 0.833,
        participant2Pct: 88.652,
        participant1Share: 0.931,
      },
      deltaPercentagePoints: 83.226,
      direction: "participant2",
    };

    expect(computeMarketPosition(withSignal, p1, p2, 14_999)?.share1).toBeCloseTo(84.157, 3);
    expect(computeMarketPosition(withSignal, p1, p2, 15_000)).toMatchObject({
      share1: 0.931,
      observedTeam: 2,
      observedPct: 99.069,
      dominant: 2,
    });
    const displayMovement = pulseDisplayMovement(withSignal, p1, p2);
    expect(displayMovement.team).toBe(2);
    expect(displayMovement.beforePct).toBeCloseTo(15.843, 3);
    expect(displayMovement.afterPct).toBeCloseTo(99.069, 3);
    expect(displayMovement.deltaPercentagePoints).toBeCloseTo(83.226, 3);
  });

  it("maps TxLINE part1/part2 aliases to the real teams", () => {
    const positionalOutcome = structuredClone(turningPoint);
    positionalOutcome.movement.tuple.priceName = "part2";
    expect(computeMarketPosition(positionalOutcome, p1, p2, 15_000)).toMatchObject({
      observedTeam: 2,
      observedPct: 88.652,
      share1: 11.348,
      dominant: 2,
    });
  });

  it("refuses to invent a team position when the odds outcome cannot be mapped", () => {
    const unknown = structuredClone(turningPoint);
    unknown.movement.tuple.priceName = "Draw";
    expect(computeMarketPosition(unknown, p1, p2, 15_000)).toBeNull();
  });
});

describe("fanRead", () => {
  it("explains known actions in both languages", () => {
    expect(fanRead("goal", "pt-BR")).toContain("Gol");
    expect(fanRead("goal", "en")).toContain("Goal");
  });
  it("falls back for unknown actions", () => {
    expect(fanRead("mystery", "en").length).toBeGreaterThan(0);
  });
});

describe("insightFanRead", () => {
  it("reads an upward move as market backing the team", () => {
    expect(insightFanRead("up", "Aurora FC", "en")).toContain("Aurora FC");
    expect(insightFanRead("up", "Aurora FC", "pt-BR")).toContain("Aurora FC");
  });
  it("reads a downward move as the market cooling", () => {
    expect(insightFanRead("down", "Vento Sul", "en")).toContain("cooled");
  });
});
