import { describe, expect, it } from "vitest";
import { buildValidationArguments } from "../server/proof";
import type { RawValidationPayload } from "../src/types";
import scenario from "./fixtures/txline-contract-scenario.json";

describe("validateStatV2 argument construction", () => {
  const expectation = {
    fixtureId: "18241006",
    seq: 4,
    eventTs: 1784143500000,
    statKeys: [1, 2] as const,
    score: { participant1: 1, participant2: 2 },
  };

  it("constructs BN-backed payload fields without relying on removed Anchor exports", () => {
    const built = buildValidationArguments(
      scenario.validation as RawValidationPayload,
      expectation,
    );
    expect(built.epochDay).toBe(20649);
    expect(built.proofTargetTs).toBe(1784143500000);
    expect(built.payload.ts.toString()).toBe("1784143500000");
    expect(built.payload.fixtureSummary.fixtureId.toString()).toBe("18241006");
    expect(built.payload.stats).toHaveLength(2);
    expect(built.strategy.discretePredicates).toHaveLength(2);
  });

  it("rejects proof payloads for another fixture or event timestamp", () => {
    const wrongFixture = structuredClone(scenario.validation) as RawValidationPayload;
    (wrongFixture.summary as { fixtureId: number }).fixtureId = 99999999;
    expect(() => buildValidationArguments(wrongFixture, expectation)).toThrow(/fixture/i);

    const wrongTimestamp = structuredClone(scenario.validation) as RawValidationPayload;
    (wrongTimestamp.summary as { updateStats: { minTimestamp: number } }).updateStats.minTimestamp += 1;
    expect(() => buildValidationArguments(wrongTimestamp, expectation)).toThrow(/timestamp/i);
  });

  it("rejects reversed requested keys or stat values before on-chain view", () => {
    expect(() => buildValidationArguments(
      scenario.validation as RawValidationPayload,
      { ...expectation, statKeys: [2, 1] as unknown as readonly [1, 2] }
    )).toThrow(/statKeys=1,2/);

    const reversedValues = structuredClone(scenario.validation) as RawValidationPayload;
    reversedValues.statsToProve = [{ value: 2 }, { value: 1 }];
    expect(() => buildValidationArguments(reversedValues, expectation)).toThrow(/score values/i);
  });
});
