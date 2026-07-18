import type { MarketMovement, RawOddsPayload } from "./types.js";

type Candidate = {
  tupleKey: string;
  tuple: MarketMovement["tuple"];
  ts: number;
  pct: number;
};

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nullableTupleScalar(value: unknown): { valid: true; value: string | null } | { valid: false } {
  if (value === null) return { valid: true, value: null };
  const parsed = scalar(value);
  return parsed === null || parsed === "" ? { valid: false } : { valid: true, value: parsed };
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value.toUpperCase() !== "NA") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function candidates(rows: RawOddsPayload[]): Candidate[] {
  const result: Candidate[] = [];
  for (const row of rows) {
    const bookmakerId = text(row.BookmakerId);
    const superOddsType = scalar(row.SuperOddsType);
    const marketPeriod = nullableTupleScalar(row.MarketPeriod);
    const marketParameters = nullableTupleScalar(row.MarketParameters);
    const ts = number(row.Ts ?? row.ts);
    if (!bookmakerId || !superOddsType || !marketPeriod.valid || !marketParameters.valid || ts === null) continue;
    if (!Array.isArray(row.PriceNames) || !Array.isArray(row.Pct)) continue;
    row.PriceNames.forEach((rawPriceName, index) => {
      const priceName = text(rawPriceName);
      const pct = number((row.Pct as unknown[])[index]);
      if (!priceName || pct === null || pct < 0 || pct > 100) return;
      const tuple = {
        bookmakerId,
        superOddsType,
        marketPeriod: marketPeriod.value,
        marketParameters: marketParameters.value,
        priceName,
      };
      result.push({ tuple, tupleKey: JSON.stringify(tuple), ts, pct });
    });
  }
  return result;
}

/** Compare only identical returned market tuples; no market semantics are assumed. */
export function strongestComparableMovement(
  beforeRows: RawOddsPayload[],
  afterRows: RawOddsPayload[]
): MarketMovement | null {
  const before = candidates(beforeRows);
  const after = candidates(afterRows);
  let strongest: MarketMovement | null = null;
  for (const left of before) {
    for (const right of after) {
      if (left.tupleKey !== right.tupleKey) continue;
      const delta = right.pct - left.pct;
      const movement: MarketMovement = {
        tuple: left.tuple,
        before: { ts: left.ts, pct: left.pct },
        after: { ts: right.ts, pct: right.pct },
        deltaPercentagePoints: Math.round(Math.abs(delta) * 1000) / 1000,
        direction: delta >= 0 ? "up" : "down",
      };
      if (!strongest || movement.deltaPercentagePoints > strongest.deltaPercentagePoints) {
        strongest = movement;
      }
    }
  }
  return strongest && strongest.deltaPercentagePoints > 0 ? strongest : null;
}
