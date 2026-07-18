import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strongestComparableMovement } from "../src/momentum.js";
import { REPLAY_CONTRACT, assertReplayEnvelopeContract } from "../src/replay-contract.js";
import { curateReplayEvents, normalizeScoreEvents } from "../src/timeline.js";
import type {
  RawFixture,
  RawOddsPayload,
  RawScoreEvent,
  RawValidationPayload,
  ReplayEnvelope,
  ReplayEvent,
  ReplayMatch,
} from "../src/types.js";
import type { ServerConfig } from "./config.js";
import { TXLINE_PROGRAM_ID } from "./config.js";
import {
  ProofUnavailableError,
  ProofTimeoutError,
  validateStatV2View,
  type ProofExpectation,
  type ProofViewResult,
} from "./proof.js";
import { createTxlineClient, payloadArray, TxlineRequestError } from "./txline-client.js";

export type ProofVerifier = (
  proof: RawValidationPayload,
  expected: ProofExpectation,
  rpcUrl: string,
  replaySignal?: AbortSignal,
) => Promise<ProofViewResult>;

export const REPLAY_TOTAL_TIMEOUT_MS = 12_000;

export interface ReplayDependencies {
  fetchImpl?: typeof fetch;
  verifyProof?: ProofVerifier;
  now?: () => Date;
  /** Test-only deadline override. Production callers always use 12 seconds. */
  totalTimeoutMs?: number;
}

async function waitWithinReplayDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new ProofTimeoutError("The complete replay deadline expired before proof validation.");
  return await new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(
      new ProofTimeoutError("The complete replay deadline expired during proof validation."),
    );
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolvePromise(value); },
      (error: unknown) => { cleanup(); rejectPromise(error); },
    );
  });
}

function string(value: unknown): string | null {
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

function fixtureToMatch(raw: RawFixture, expectedFixtureId: string): ReplayMatch {
  const fixtureId = string(raw.FixtureId ?? raw.fixtureId);
  const participant1 = string(raw.Participant1);
  const participant2 = string(raw.Participant2);
  const participant1Id = string(raw.Participant1Id);
  const participant2Id = string(raw.Participant2Id);
  const startTime = number(raw.StartTime ?? raw.startTime);
  if (
    fixtureId !== expectedFixtureId ||
    !participant1 ||
    !participant2 ||
    !participant1Id ||
    !participant2Id ||
    startTime === null
  ) {
    throw new TxlineRequestError("TXLINE_FIXTURE_SCHEMA", "The selected TxLINE fixture is missing required fields.", 502);
  }
  return {
    fixtureId,
    competition: string(raw.Competition ?? raw.CompetitionName),
    startTime,
    participant1: { id: participant1Id, name: participant1, side: "participant1" },
    participant2: { id: participant2Id, name: participant2, side: "participant2" },
    participant1IsHome: typeof raw.Participant1IsHome === "boolean" ? raw.Participant1IsHome : null,
  };
}

function chooseFactualEvent(events: ReplayEvent[]): ReplayEvent | null {
  const goals = events.filter((event) => event.action === "goal" && event.score);
  let previousLeader: "participant1" | "participant2" | null = null;
  for (const goal of goals) {
    const { participant1, participant2 } = goal.score ?? {};
    if (participant1 === null || participant1 === undefined || participant2 === null || participant2 === undefined) {
      continue;
    }
    const leader = participant1 === participant2
      ? null
      : participant1 > participant2
        ? "participant1"
        : "participant2";
    if (leader && previousLeader && leader !== previousLeader) return goal;
    if (leader) previousLeader = leader;
  }
  if (goals.length > 0) return goals[0];
  const material = events.filter(
    (event) => ["yellow_card", "red_card", "penalty", "var_end"].includes(event.action) && event.score
  );
  return material[0] ?? events.find((event) => event.score) ?? null;
}

function proofReason(error: unknown): string {
  if (error instanceof ProofTimeoutError) return "proof_timeout";
  if (error instanceof ProofUnavailableError) return "proof_shape_unavailable";
  return "onchain_view_failed";
}

export async function buildRealReplay(
  config: ServerConfig,
  fixtureId: string,
  dependencies: ReplayDependencies = {}
): Promise<ReplayEnvelope> {
  if (fixtureId !== config.fixtureId) {
    throw new TxlineRequestError("FIXTURE_NOT_FROZEN", "Only the frozen demo fixture is available.", 404);
  }
  const now = dependencies.now ?? (() => new Date());
  const replaySignal = AbortSignal.timeout(dependencies.totalTimeoutMs ?? REPLAY_TOTAL_TIMEOUT_MS);
  const client = createTxlineClient(config, dependencies.fetchImpl, replaySignal);
  const fixturesPayload = await client.get(
    `/fixtures/snapshot?startEpochDay=${config.startEpochDay}`,
    "fixtures_snapshot"
  );
  const rawFixture = payloadArray(fixturesPayload, ["fixtures", "items"]).find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const fixture = candidate as RawFixture;
    return string(fixture.FixtureId ?? fixture.fixtureId) === fixtureId;
  }) as RawFixture | undefined;
  if (!rawFixture) {
    throw new TxlineRequestError("TXLINE_FIXTURE_NOT_FOUND", "Frozen fixture was not returned by TxLINE.", 502);
  }
  const match = fixtureToMatch(rawFixture, fixtureId);

  const scoresPayload = await client.get(`/scores/historical/${fixtureId}`, "scores_historical");
  const rawScores = payloadArray(scoresPayload, ["scores", "events", "items"]) as RawScoreEvent[];
  const normalized = normalizeScoreEvents(rawScores, match);
  if (normalized.events.length === 0) {
    throw new TxlineRequestError("TXLINE_SCORES_EMPTY", "TxLINE returned no usable score events.", 502);
  }
  const replayEvents = curateReplayEvents(normalized.events);
  const factualEvent = chooseFactualEvent(replayEvents);
  if (!factualEvent) {
    throw new TxlineRequestError("TXLINE_EVENT_UNAVAILABLE", "No factual event is available for replay.", 502);
  }

  const beforeAsOf = factualEvent.ts - 120_000;
  const afterAsOf = factualEvent.ts + 120_000;
  const [beforeResult, afterResult] = await Promise.allSettled([
    client.get(`/odds/snapshot/${fixtureId}?asOf=${beforeAsOf}`, "odds_before"),
    client.get(`/odds/snapshot/${fixtureId}?asOf=${afterAsOf}`, "odds_after"),
  ]);
  for (const result of [beforeResult, afterResult]) {
    if (
      result.status === "rejected" &&
      result.reason instanceof TxlineRequestError &&
      ["TXLINE_AUTH_FAILED", "TXLINE_CREDENTIALS_MISSING", "TXLINE_REDIRECT_REJECTED"].includes(result.reason.code)
    ) {
      throw result.reason;
    }
  }
  const oddsAvailable = beforeResult.status === "fulfilled" && afterResult.status === "fulfilled";
  const beforeOdds = beforeResult.status === "fulfilled"
    ? payloadArray(beforeResult.value, ["odds", "items"]) as RawOddsPayload[]
    : [];
  const afterOdds = afterResult.status === "fulfilled"
    ? payloadArray(afterResult.value, ["odds", "items"]) as RawOddsPayload[]
    : [];
  const movement = oddsAvailable
    ? strongestComparableMovement(beforeOdds, afterOdds, fixtureId)
    : null;
  const turningPointReason: ReplayEnvelope["turningPointReason"] = movement
    ? null
    : oddsAvailable
      ? "no_comparable_tuple"
      : "odds_unavailable";

  let proofState: ReplayEnvelope["provenance"]["state"] = "unavailable";
  let proofEpochDay: number | null = null;
  let dailyScoresPda: string | null = null;
  let proofTargetTs: number | null = null;
  let proofCheckedAt: string | null = null;
  let reason: string | null = null;
  if (!factualEvent.score) {
    reason = "participant_nested_score_missing";
  } else {
    try {
      const rawProof = (await client.get(
        `/scores/stat-validation?fixtureId=${fixtureId}&seq=${factualEvent.seq}&statKeys=1,2`,
        "scores_stat_validation"
      )) as RawValidationPayload;
      const verifier = dependencies.verifyProof ?? validateStatV2View;
      proofCheckedAt = now().toISOString();
      try {
        const viewed = await waitWithinReplayDeadline(
          verifier(rawProof, {
            fixtureId,
            seq: factualEvent.seq,
            eventTs: factualEvent.ts,
            statKeys: [1, 2],
            score: factualEvent.score,
          }, config.rpcUrl, replaySignal),
          replaySignal,
        );
        proofEpochDay = viewed.epochDay;
        dailyScoresPda = viewed.dailyScoresPda;
        proofTargetTs = viewed.proofTargetTs;
        const contextMatches = viewed.proofTargetTs === factualEvent.ts;
        proofState = viewed.valid && contextMatches ? "verified" : "failed";
        reason = viewed.valid && !contextMatches
          ? "proof_context_mismatch"
          : viewed.valid
            ? null
            : "onchain_view_rejected";
      } catch (error) {
        proofState = error instanceof ProofUnavailableError ? "unavailable" : "failed";
        reason = proofReason(error);
      }
    } catch (error) {
      if (error instanceof TxlineRequestError && error.code === "TXLINE_AUTH_FAILED") throw error;
      const proofTimedOut = error instanceof TxlineRequestError && error.code === "TXLINE_TIMEOUT";
      proofState = proofTimedOut || (error instanceof TxlineRequestError && error.upstreamStatus === 404)
        ? "unavailable"
        : "failed";
      reason = proofTimedOut
        ? "proof_timeout"
        : proofState === "unavailable"
          ? "proof_endpoint_unavailable"
          : "proof_request_failed";
    }
  }

  const endpointOrder = ["fixtures_snapshot", "scores_historical", "odds_before", "odds_after", "scores_stat_validation"];
  return {
    schemaVersion: REPLAY_CONTRACT.schemaVersion,
    source: {
      provider: "TxLINE",
      mode: "real_txline",
      network: "devnet",
      fetchedAt: now().toISOString(),
      transformed: true,
      rawPayloadIncluded: false,
      endpoints: [...client.evidence].sort((left, right) => endpointOrder.indexOf(left.id) - endpointOrder.indexOf(right.id)),
    },
    match,
    events: replayEvents,
    issues: normalized.issues,
    turningPoint: movement
      ? {
          eventSeq: factualEvent.seq,
          eventTs: factualEvent.ts,
          playbackMs: factualEvent.playbackMs,
          minute: factualEvent.minute,
          action: factualEvent.action,
          participantName: factualEvent.participantName,
          movement,
        }
      : null,
    turningPointReason,
    provenance: {
      state: proofState,
      network: "devnet",
      programId: TXLINE_PROGRAM_ID,
      fixtureId,
      seq: factualEvent.seq,
      statKeys: [1, 2],
      epochDay: proofEpochDay,
      dailyScoresPda,
      proofTargetTs,
      checkedAt: proofCheckedAt,
      reason,
    },
    playbackDurationMs: REPLAY_CONTRACT.playbackDurationMs,
  };
}

export async function loadSyntheticReplay(now: () => Date = () => new Date()): Promise<ReplayEnvelope> {
  const path = resolve(process.cwd(), "fixtures/fictional-test-scenario.json");
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  assertReplayEnvelopeContract(raw);
  const parsed = raw as ReplayEnvelope;
  if (parsed.source.mode !== "synthetic" || parsed.provenance.state !== "synthetic_unverified") {
    throw new Error("Fictional fixture must remain synthetic_unverified.");
  }
  parsed.source.fetchedAt = now().toISOString();
  return parsed;
}
