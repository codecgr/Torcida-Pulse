import { describe, expect, it } from "vitest";
import { strongestComparableMovement } from "../src/momentum";
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
});
