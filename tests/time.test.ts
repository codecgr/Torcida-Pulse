import { describe, expect, it } from "vitest";
import { formatInTz, minuteLabel } from "../src/time";

describe("UTC and BRT boundaries", () => {
  it("maps 2026-07-19 02:30 UTC to the previous calendar day in Sao Paulo", () => {
    const ts = Date.parse("2026-07-19T02:30:00.000Z");
    expect(formatInTz(ts, "America/Sao_Paulo")).toContain("2026-07-18 23:30:00 GMT-3");
    expect(formatInTz(ts, "UTC")).toContain("2026-07-19 02:30:00 GMT");
  });

  it("formats unknown and factual match minutes safely", () => {
    expect(minuteLabel(undefined)).toBe("N/D");
    expect(minuteLabel(15)).toBe("15'");
  });
});
