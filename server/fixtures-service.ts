import type { FixtureCatalogEnvelope, FixtureCatalogEntry, RawFixture } from "../src/types.js";
import type { ReplayDependencies } from "./replay-service.js";
import type { ServerConfig } from "./config.js";
import { createTxlineClient, payloadArray } from "./txline-client.js";

export const WORLD_CUP_START_EPOCH_DAY = 20_615;

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fixtureStatus(rawState: unknown, startTime: number, nowMs: number): FixtureCatalogEntry["status"] {
  const state = text(rawState)?.toLowerCase() ?? "";
  const definitelyFinished = new Set(["3", "5", "10", "13", "f", "fet", "fpe", "ended", "finished"]);
  if (definitelyFinished.has(state)) return "finished";
  if (nowMs < startTime - 15 * 60_000) return "scheduled";
  if (nowMs <= startTime + 5 * 60 * 60_000) return "live";
  return "finished";
}

/** Return a narrow allowlist of World Cup fixtures from TxLINE. This is not a
 * general fixture proxy: other competitions and raw fields are discarded. */
export async function listWorldCupFixtures(
  config: ServerConfig,
  dependencies: ReplayDependencies = {},
): Promise<FixtureCatalogEnvelope> {
  const now = dependencies.now ?? (() => new Date());
  const signal = AbortSignal.timeout(dependencies.totalTimeoutMs ?? 12_000);
  const client = createTxlineClient(config, dependencies.fetchImpl, signal);
  const payload = await client.get(
    `/fixtures/snapshot?startEpochDay=${WORLD_CUP_START_EPOCH_DAY}`,
    "fixtures_snapshot",
  );
  const byId = new Map<string, FixtureCatalogEntry>();
  for (const raw of payloadArray(payload, ["fixtures", "items"]) as RawFixture[]) {
    const competition = text(raw.Competition ?? raw.CompetitionName);
    if (competition?.toLowerCase() !== "world cup") continue;
    const fixtureId = text(raw.FixtureId ?? raw.fixtureId);
    const participant1 = text(raw.Participant1);
    const participant2 = text(raw.Participant2);
    const startTime = number(raw.StartTime ?? raw.startTime);
    if (!fixtureId || !/^\d+$/.test(fixtureId) || !participant1 || !participant2 || startTime === null) continue;
    byId.set(fixtureId, {
      fixtureId,
      competition: "World Cup",
      startTime,
      participant1,
      participant2,
      status: fixtureStatus(raw.GameState, startTime, now().getTime()),
    });
  }
  const statusOrder = { live: 0, scheduled: 1, finished: 2 } as const;
  const fixtures = [...byId.values()].sort((left, right) =>
    statusOrder[left.status] - statusOrder[right.status] ||
    (left.status === "finished" ? right.startTime - left.startTime : left.startTime - right.startTime) ||
    left.fixtureId.localeCompare(right.fixtureId)
  );
  return {
    source: "TxLINE",
    fetchedAt: now().toISOString(),
    competition: "World Cup",
    fixtures,
  };
}
