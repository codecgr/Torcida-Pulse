import { describe, expect, it } from "vitest";
import { computeMarketPosition, fanRead, insightFanRead } from "../src/fan";
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
