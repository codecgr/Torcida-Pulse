import { describe, expect, it } from "vitest";
import {
  participantSignalForSeries,
  nearestRowsForSeries,
  selectCanonicalMatchWinnerSeries,
  strongestComparableMovement,
  strongestComparableMovementForSeries,
} from "../src/momentum";
import type { RawOddsPayload } from "../src/types";

function odds(overrides: Partial<RawOddsPayload> = {}): RawOddsPayload {
  return {
    FixtureId: 1,
    MessageId: "fictional",
    Ts: 100,
    BookmakerId: 7,
    SuperOddsType: "RETURNED_TYPE",
    MarketPeriod: "RETURNED_PERIOD",
    MarketParameters: "RETURNED_PARAMETERS",
    PriceNames: ["A", "B"],
    Pct: ["40", "60"],
    ...overrides,
  };
}

describe("Momento da Virada market comparison", () => {
  it("chooses the strongest PriceName within an identical returned tuple", () => {
    const movement = strongestComparableMovement(
      [odds()],
      [odds({ Ts: 200, Pct: ["65", "35"] })],
      "1"
    );
    expect(movement?.tuple).toEqual({
      bookmakerId: "7",
      superOddsType: "RETURNED_TYPE",
      marketPeriod: "RETURNED_PERIOD",
      marketParameters: "RETURNED_PARAMETERS",
      priceName: "A",
    });
    expect(movement?.deltaPercentagePoints).toBe(25);
  });

  it("returns null rather than comparing mismatched market parameters", () => {
    expect(strongestComparableMovement(
      [odds()],
      [odds({ MarketParameters: "DIFFERENT" })],
      "1"
    )).toBeNull();
  });

  it("can preserve an unchanged real position for the always-on thermometer", () => {
    expect(strongestComparableMovement([odds()], [odds({ Ts: 200 })], "1")).toBeNull();
    expect(strongestComparableMovement([odds()], [odds({ Ts: 200 })], "1", true)).toMatchObject({
      after: { pct: 40 },
      deltaPercentagePoints: 0,
    });
  });

  it("compares identical explicit null period fields returned by live snapshots", () => {
    const movement = strongestComparableMovement(
      [odds({ MarketPeriod: null, MarketParameters: null })],
      [odds({ Ts: 200, MarketPeriod: null, MarketParameters: null, Pct: ["52", "48"] })],
      "1"
    );
    expect(movement?.tuple.marketPeriod).toBeNull();
    expect(movement?.tuple.marketParameters).toBeNull();
    expect(movement?.deltaPercentagePoints).toBe(12);
  });

  it("ignores NA, missing tuples, and out-of-range percentages", () => {
    expect(strongestComparableMovement(
      [odds({ Pct: ["NA", "120"] })],
      [odds({ Ts: 200 })],
      "1"
    )).toBeNull();
  });

  it("ignores odds rows missing or mismatching the selected fixture", () => {
    expect(strongestComparableMovement(
      [odds({ FixtureId: 99999999 })],
      [odds({ FixtureId: 99999999, Ts: 200, Pct: ["65", "35"] })],
      "1"
    )).toBeNull();
    expect(strongestComparableMovement(
      [odds({ FixtureId: undefined })],
      [odds({ FixtureId: undefined, Ts: 200, Pct: ["65", "35"] })],
      "1"
    )).toBeNull();
  });

  it("locks the Pulse to the full-match 1X2 series instead of chasing the largest move", () => {
    const fullMatchBefore = odds({
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketPeriod: null,
      MarketParameters: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: ["35", "34", "31"],
    });
    const fullMatchAfter = odds({
      Ts: 200,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketPeriod: null,
      MarketParameters: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: ["36", "34", "30"],
    });
    const volatileHandicapBefore = odds({
      SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS",
      MarketPeriod: "half=1",
      MarketParameters: "line=0",
      Pct: ["68", "32"],
    });
    const volatileHandicapAfter = odds({
      Ts: 200,
      SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS",
      MarketPeriod: "half=1",
      MarketParameters: "line=0",
      Pct: ["20", "80"],
    });
    const resolveTeam = (name: string) => name === "part1" ? 1 as const : name === "part2" ? 2 as const : null;

    const series = selectCanonicalMatchWinnerSeries(
      [
        [fullMatchBefore, volatileHandicapBefore],
        [fullMatchAfter, volatileHandicapAfter],
      ],
      "1",
      resolveTeam,
    );

    expect(series).toEqual({
      bookmakerId: "7",
      superOddsType: "1X2_PARTICIPANT_RESULT",
      marketPeriod: null,
      marketParameters: null,
    });
    expect(strongestComparableMovementForSeries(
      [fullMatchBefore, volatileHandicapBefore],
      [fullMatchAfter, volatileHandicapAfter],
      "1",
      series!,
      resolveTeam,
      true,
    )?.deltaPercentagePoints).toBe(1);
  });

  it("normalizes the two participant outcomes without counting the draw as either team", () => {
    const before = odds({
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketPeriod: null,
      MarketParameters: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: ["35.125", "33.807", "31.066"],
    });
    const after = odds({
      Ts: 200,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketPeriod: null,
      MarketParameters: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: ["32.744", "42.753", "24.510"],
    });
    const resolveTeam = (name: string) => name === "part1" ? 1 as const : name === "part2" ? 2 as const : null;
    const series = {
      bookmakerId: "7",
      superOddsType: "1X2_PARTICIPANT_RESULT",
      marketPeriod: null,
      marketParameters: null,
    };

    const signal = participantSignalForSeries([before], [after], "1", series, resolveTeam);

    expect(signal?.before.participant1Share).toBeCloseTo(53.066, 3);
    expect(signal?.after.participant1Share).toBeCloseTo(57.191, 3);
    expect(signal?.deltaPercentagePoints).toBeCloseTo(4.125, 3);
    expect(signal?.direction).toBe("participant1");
  });

  it("refuses to substitute a half or handicap market when full-match 1X2 is unavailable", () => {
    const resolveTeam = (name: string) => name === "A" ? 1 as const : name === "B" ? 2 as const : null;
    expect(selectCanonicalMatchWinnerSeries([[odds()]], "1", resolveTeam)).toBeNull();
  });

  it("selects the nearest live rows around an event without crossing market series", () => {
    const series = {
      bookmakerId: "7",
      superOddsType: "1X2_PARTICIPANT_RESULT",
      marketPeriod: null,
      marketParameters: null,
    };
    const liveRows = [100, 200, 300].flatMap((Ts) => [
      odds({
        Ts,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        MarketPeriod: null,
        MarketParameters: null,
      }),
      odds({ Ts, SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS" }),
    ]);

    const around = nearestRowsForSeries(liveRows, "1", series, 240);

    expect(around.before.map((row) => row.Ts)).toEqual([200]);
    expect(around.after.map((row) => row.Ts)).toEqual([300]);
    expect(around.before.every((row) => row.SuperOddsType === "1X2_PARTICIPANT_RESULT")).toBe(true);
  });
});
