import { describe, expect, it } from "vitest";
import { buildValidationArguments } from "../server/proof";
import type { RawValidationPayload } from "../src/types";
import scenario from "./fixtures/txline-contract-scenario.json";

describe("validateStatV2 argument construction", () => {
  it("constructs BN-backed payload fields without relying on removed Anchor exports", () => {
    const built = buildValidationArguments(
      scenario.validation as RawValidationPayload,
      { participant1: 1, participant2: 2 },
    );
    expect(built.epochDay).toBe(20649);
    expect(built.payload.ts.toString()).toBe("1784143500000");
    expect(built.payload.fixtureSummary.fixtureId.toString()).toBe("18241006");
    expect(built.payload.stats).toHaveLength(2);
    expect(built.strategy.discretePredicates).toHaveLength(2);
  });
});
