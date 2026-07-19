import type {
  MarketMovement,
  MarketSeriesTuple,
  ParticipantSignal,
  ParticipantSignalPoint,
  RawOddsPayload,
} from "./types.js";

type Candidate = {
  tupleKey: string;
  seriesKey: string;
  tuple: MarketMovement["tuple"];
  ts: number;
  pct: number;
};

type ResolveTeam = (priceName: string) => 1 | 2 | null;

function seriesTuple(tuple: MarketMovement["tuple"]): MarketSeriesTuple {
  return {
    bookmakerId: tuple.bookmakerId,
    superOddsType: tuple.superOddsType,
    marketPeriod: tuple.marketPeriod,
    marketParameters: tuple.marketParameters,
  };
}

function seriesKey(tuple: MarketSeriesTuple): string {
  return JSON.stringify(tuple);
}

function sameSeries(left: MarketSeriesTuple, right: MarketSeriesTuple): boolean {
  return seriesKey(left) === seriesKey(right);
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

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

function candidates(rows: RawOddsPayload[], expectedFixtureId: string): Candidate[] {
  const result: Candidate[] = [];
  for (const row of rows) {
    if (text(row.FixtureId ?? row.fixtureId) !== expectedFixtureId) continue;
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
      result.push({
        tuple,
        tupleKey: JSON.stringify(tuple),
        seriesKey: seriesKey(seriesTuple(tuple)),
        ts,
        pct,
      });
    });
  }
  return result;
}

/** Select one auditable match-winner series for the complete replay.
 *
 * A "who is on top" meter cannot swap into first-half or handicap markets.
 * We therefore accept only full-match, parameter-free 1X2 rows containing
 * both participants and select the bookmaker with the widest snapshot
 * coverage. No movement magnitude participates in this choice. */
export function selectCanonicalMatchWinnerSeries(
  snapshots: RawOddsPayload[][],
  expectedFixtureId: string,
  resolveTeam: ResolveTeam,
): MarketSeriesTuple | null {
  const coverage = new Map<string, { tuple: MarketSeriesTuple; snapshots: Set<number> }>();
  snapshots.forEach((rows, snapshotIndex) => {
    const bySeries = new Map<string, Candidate[]>();
    for (const candidate of candidates(rows, expectedFixtureId)) {
      const tuple = seriesTuple(candidate.tuple);
      if (tuple.superOddsType.toUpperCase() !== "1X2_PARTICIPANT_RESULT") continue;
      if (tuple.marketPeriod !== null || tuple.marketParameters !== null) continue;
      const grouped = bySeries.get(candidate.seriesKey) ?? [];
      grouped.push(candidate);
      bySeries.set(candidate.seriesKey, grouped);
    }
    for (const [key, grouped] of bySeries) {
      const sides = new Set(grouped.map(({ tuple }) => resolveTeam(tuple.priceName)).filter((side) => side !== null));
      if (!sides.has(1) || !sides.has(2)) continue;
      const current = coverage.get(key) ?? {
        tuple: seriesTuple(grouped[0].tuple),
        snapshots: new Set<number>(),
      };
      current.snapshots.add(snapshotIndex);
      coverage.set(key, current);
    }
  });

  return [...coverage.values()]
    .sort((left, right) =>
      right.snapshots.size - left.snapshots.size ||
      seriesKey(left.tuple).localeCompare(seriesKey(right.tuple))
    )[0]?.tuple ?? null;
}

function participantPointForSeries(
  rows: RawOddsPayload[],
  expectedFixtureId: string,
  series: MarketSeriesTuple,
  resolveTeam: ResolveTeam,
): ParticipantSignalPoint | null {
  const byTimestamp = new Map<number, Map<1 | 2, Candidate>>();
  for (const candidate of candidates(rows, expectedFixtureId)) {
    if (!sameSeries(seriesTuple(candidate.tuple), series)) continue;
    const side = resolveTeam(candidate.tuple.priceName);
    if (side === null) continue;
    const grouped = byTimestamp.get(candidate.ts) ?? new Map<1 | 2, Candidate>();
    grouped.set(side, candidate);
    byTimestamp.set(candidate.ts, grouped);
  }

  for (const [ts, grouped] of [...byTimestamp.entries()].sort((left, right) => right[0] - left[0])) {
    const participant1 = grouped.get(1);
    const participant2 = grouped.get(2);
    if (!participant1 || !participant2) continue;
    const participantTotal = participant1.pct + participant2.pct;
    if (participantTotal <= 0) continue;
    return {
      ts,
      participant1Pct: participant1.pct,
      participant2Pct: participant2.pct,
      participant1Share: rounded((participant1.pct / participantTotal) * 100),
    };
  }
  return null;
}

/** Compare the actual two participant outcomes from the same canonical 1X2
 * series. Draw probability is deliberately excluded from both team shares. */
export function participantSignalForSeries(
  beforeRows: RawOddsPayload[],
  afterRows: RawOddsPayload[],
  expectedFixtureId: string,
  series: MarketSeriesTuple,
  resolveTeam: ResolveTeam,
): ParticipantSignal | null {
  const before = participantPointForSeries(beforeRows, expectedFixtureId, series, resolveTeam);
  const after = participantPointForSeries(afterRows, expectedFixtureId, series, resolveTeam);
  if (!before || !after) return null;
  const delta = rounded(after.participant1Share - before.participant1Share);
  return {
    tuple: series,
    before,
    after,
    deltaPercentagePoints: Math.abs(delta),
    direction: delta > 0 ? "participant1" : delta < 0 ? "participant2" : "flat",
  };
}

/** Slice the current TxLINE odds cache into the closest canonical snapshots
 * around one live event. Rows from other market families are never returned. */
export function nearestRowsForSeries(
  rows: RawOddsPayload[],
  expectedFixtureId: string,
  series: MarketSeriesTuple,
  eventTs: number,
): { before: RawOddsPayload[]; after: RawOddsPayload[] } {
  const matching = rows.flatMap((row) => {
    const candidate = candidates([row], expectedFixtureId).find(
      ({ tuple }) => sameSeries(seriesTuple(tuple), series),
    );
    return candidate ? [{ row, ts: candidate.ts }] : [];
  });
  const beforeTs = matching
    .filter(({ ts }) => ts <= eventTs)
    .reduce<number | null>((latest, { ts }) => latest === null || ts > latest ? ts : latest, null);
  const afterTs = matching
    .filter(({ ts }) => ts >= eventTs)
    .reduce<number | null>((earliest, { ts }) => earliest === null || ts < earliest ? ts : earliest, null);
  return {
    before: beforeTs === null ? [] : matching.filter(({ ts }) => ts === beforeTs).map(({ row }) => row),
    after: afterTs === null ? [] : matching.filter(({ ts }) => ts === afterTs).map(({ row }) => row),
  };
}

/** Raw participant movement for cards/audit, constrained to one market series. */
export function strongestComparableMovementForSeries(
  beforeRows: RawOddsPayload[],
  afterRows: RawOddsPayload[],
  expectedFixtureId: string,
  series: MarketSeriesTuple,
  resolveTeam: ResolveTeam,
  includeFlat = false,
): MarketMovement | null {
  const before = candidates(beforeRows, expectedFixtureId).filter(
    ({ tuple }) => sameSeries(seriesTuple(tuple), series) && resolveTeam(tuple.priceName) !== null,
  );
  const after = candidates(afterRows, expectedFixtureId).filter(
    ({ tuple }) => sameSeries(seriesTuple(tuple), series) && resolveTeam(tuple.priceName) !== null,
  );
  let strongest: MarketMovement | null = null;
  for (const left of before) {
    for (const right of after) {
      if (left.tupleKey !== right.tupleKey) continue;
      const delta = right.pct - left.pct;
      const movement: MarketMovement = {
        tuple: left.tuple,
        before: { ts: left.ts, pct: left.pct },
        after: { ts: right.ts, pct: right.pct },
        deltaPercentagePoints: rounded(Math.abs(delta)),
        direction: delta >= 0 ? "up" : "down",
      };
      if (!strongest || movement.deltaPercentagePoints > strongest.deltaPercentagePoints) strongest = movement;
    }
  }
  return strongest && (includeFlat || strongest.deltaPercentagePoints > 0) ? strongest : null;
}

/** Compare only identical returned market tuples; no market semantics are assumed. */
export function strongestComparableMovement(
  beforeRows: RawOddsPayload[],
  afterRows: RawOddsPayload[],
  expectedFixtureId: string,
  includeFlat = false,
  acceptPriceName: (priceName: string) => boolean = () => true,
): MarketMovement | null {
  const before = candidates(beforeRows, expectedFixtureId).filter(({ tuple }) => acceptPriceName(tuple.priceName));
  const after = candidates(afterRows, expectedFixtureId).filter(({ tuple }) => acceptPriceName(tuple.priceName));
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
  return strongest && (includeFlat || strongest.deltaPercentagePoints > 0) ? strongest : null;
}
