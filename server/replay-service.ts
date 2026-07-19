import {
  nearestRowsForSeries,
  participantSignalForSeries,
  selectCanonicalMatchWinnerSeries,
  strongestComparableMovementForSeries,
} from "../src/momentum.js";
import { marketOutcomeTeam } from "../src/fan.js";
import { REPLAY_CONTRACT } from "../src/replay-contract.js";
import { curateReplayEvents, ensureLiveKickoffBaseline, normalizeScoreEvents } from "../src/timeline.js";
import { computeViradaIndex } from "../src/virada-index.js";
import type {
  RawFixture,
  RawOddsPayload,
  RawScoreEvent,
  RawValidationPayload,
  ReplayEnvelope,
  ReplayMatch,
  PulseMoment,
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

function proofReason(error: unknown): string {
  if (error instanceof ProofTimeoutError) return "proof_timeout";
  if (error instanceof ProofUnavailableError) return "proof_shape_unavailable";
  return "onchain_view_failed";
}

function aggregateEndpointEvidence(evidence: ReplayEnvelope["source"]["endpoints"]): ReplayEnvelope["source"]["endpoints"] {
  const endpointOrder: ReplayEnvelope["source"]["endpoints"][number]["id"][] = [
    "fixtures_snapshot",
    "scores_historical",
    "scores_snapshot",
    "odds_before",
    "odds_after",
    "odds_live",
    "scores_stat_validation",
  ];
  return endpointOrder.flatMap((id) => {
    const samples = evidence.filter((sample) => sample.id === id);
    if (samples.length === 0) return [];
    const failure = samples.find((sample) => sample.status < 200 || sample.status >= 300);
    return [{
      id,
      status: failure?.status ?? samples[samples.length - 1].status,
      durationMs: samples.reduce((total, sample) => total + sample.durationMs, 0),
    }];
  });
}

export async function buildRealReplay(
  config: ServerConfig,
  fixtureId: string,
  dependencies: ReplayDependencies = {}
): Promise<ReplayEnvelope> {
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

  const fixtureAgeMs = now().getTime() - match.startTime;
  const usesLiveSnapshot = fixtureAgeMs >= -30 * 60_000 && fixtureAgeMs < 6 * 60 * 60_000;
  const scoresPayload = await client.get(
    usesLiveSnapshot ? `/scores/snapshot/${fixtureId}` : `/scores/historical/${fixtureId}`,
    usesLiveSnapshot ? "scores_snapshot" : "scores_historical",
  );
  const rawScores = payloadArray(scoresPayload, ["scores", "events", "items"]) as RawScoreEvent[];
  const normalized = normalizeScoreEvents(rawScores, match);
  if (normalized.events.length === 0) {
    throw new TxlineRequestError("TXLINE_SCORES_EMPTY", "TxLINE returned no usable score events.", 502);
  }
  const sourceEvents = usesLiveSnapshot ? ensureLiveKickoffBaseline(normalized.events, match) : normalized.events;
  const replayEvents = curateReplayEvents(sourceEvents, { rebaseToWindow: usesLiveSnapshot });
  const hasKickoff = sourceEvents.some(({ action }) => action === "kickoff" || action === "kick_off");
  const hasFinished = normalized.events.some(({ action }) => action === "game_finalised");
  match.status = hasFinished ? "finished" : hasKickoff ? "live" : "scheduled";

  // Historical catch-up reads one post-event position per curated event. Live
  // catch-up stays bounded: one current 5-minute odds cache plus the kickoff
  // pair, so latency does not grow with the number of events on the pitch.
  const pulseEvents = replayEvents;
  const resolveTeamOutcome = (priceName: string) =>
    marketOutcomeTeam(priceName, match.participant1, match.participant2);
  const beforeOddsBySeq = new Map<number, RawOddsPayload[]>();
  const afterOddsBySeq = new Map<number, RawOddsPayload[]>();
  let canonicalSeries: ReturnType<typeof selectCanonicalMatchWinnerSeries> = null;
  const throwAuthenticationFailure = (results: PromiseSettledResult<unknown>[]) => {
    for (const result of results) {
      if (
        result.status === "rejected" &&
        result.reason instanceof TxlineRequestError &&
        ["TXLINE_AUTH_FAILED", "TXLINE_CREDENTIALS_MISSING", "TXLINE_REDIRECT_REJECTED"].includes(result.reason.code)
      ) {
        throw result.reason;
      }
    }
  };

  if (usesLiveSnapshot) {
    const kickoff = pulseEvents.find(({ action }) => action === "kickoff" || action === "kick_off") ?? pulseEvents[0];
    const [liveOddsResult, kickoffBeforeResult, kickoffAfterResult] = await Promise.allSettled([
      client.get(`/odds/updates/${fixtureId}`, "odds_live"),
      client.get(`/odds/snapshot/${fixtureId}?asOf=${kickoff.ts - 120_000}`, "odds_before"),
      client.get(`/odds/snapshot/${fixtureId}?asOf=${kickoff.ts + 120_000}`, "odds_after"),
    ]);
    throwAuthenticationFailure([liveOddsResult, kickoffBeforeResult, kickoffAfterResult]);
    const liveOdds = liveOddsResult.status === "fulfilled"
      ? payloadArray(liveOddsResult.value, ["odds", "items"]) as RawOddsPayload[]
      : [];
    const kickoffBefore = kickoffBeforeResult.status === "fulfilled"
      ? payloadArray(kickoffBeforeResult.value, ["odds", "items"]) as RawOddsPayload[]
      : [];
    const kickoffAfter = kickoffAfterResult.status === "fulfilled"
      ? payloadArray(kickoffAfterResult.value, ["odds", "items"]) as RawOddsPayload[]
      : [];
    canonicalSeries = selectCanonicalMatchWinnerSeries(
      [kickoffAfter, liveOdds].filter((rows) => rows.length > 0),
      fixtureId,
      resolveTeamOutcome,
    );
    if (kickoffBefore.length > 0 && kickoffAfter.length > 0) {
      beforeOddsBySeq.set(kickoff.seq, kickoffBefore);
      afterOddsBySeq.set(kickoff.seq, kickoffAfter);
    }
    if (canonicalSeries && liveOdds.length > 0) {
      for (const event of pulseEvents) {
        if (event.seq === kickoff.seq) continue;
        const nearest = nearestRowsForSeries(liveOdds, fixtureId, canonicalSeries, event.ts);
        if (nearest.before.length === 0) continue;
        beforeOddsBySeq.set(event.seq, nearest.before);
        afterOddsBySeq.set(event.seq, nearest.after.length > 0 ? nearest.after : nearest.before);
      }
    }
  } else {
    const scoreChangingActions = new Set(["goal", "own_goal", "goal_cancelled"]);
    const dedicatedBeforeEvents = pulseEvents.filter((event, index) => index === 0 || scoreChangingActions.has(event.action));
    const [afterResults, dedicatedBeforeResults] = await Promise.all([
      Promise.allSettled(pulseEvents.map((event) =>
        client.get(`/odds/snapshot/${fixtureId}?asOf=${event.ts + 120_000}`, "odds_after")
      )),
      Promise.allSettled(dedicatedBeforeEvents.map((event) =>
        client.get(`/odds/snapshot/${fixtureId}?asOf=${event.ts - 120_000}`, "odds_before")
      )),
    ]);
    throwAuthenticationFailure([...afterResults, ...dedicatedBeforeResults]);
    const dedicatedBeforeBySeq = new Map(dedicatedBeforeEvents.map((event, index) => [
      event.seq,
      dedicatedBeforeResults[index],
    ]));
    canonicalSeries = selectCanonicalMatchWinnerSeries(
      afterResults.flatMap((result) => result.status === "fulfilled"
        ? [payloadArray(result.value, ["odds", "items"]) as RawOddsPayload[]]
        : []),
      fixtureId,
      resolveTeamOutcome,
    );
    let previousAfter: RawOddsPayload[] | null = null;
    for (const [index, event] of pulseEvents.entries()) {
      const afterResult = afterResults[index];
      const dedicatedBefore = dedicatedBeforeBySeq.get(event.seq);
      const before = dedicatedBefore?.status === "fulfilled"
        ? payloadArray(dedicatedBefore.value, ["odds", "items"]) as RawOddsPayload[]
        : previousAfter;
      const after = afterResult.status === "fulfilled"
        ? payloadArray(afterResult.value, ["odds", "items"]) as RawOddsPayload[]
        : null;
      if (before && after) {
        beforeOddsBySeq.set(event.seq, before);
        afterOddsBySeq.set(event.seq, after);
      }
      if (after) previousAfter = after;
    }
  }

  const eventPulses: PulseMoment[] = [];
  for (const event of pulseEvents) {
    const beforeOdds = beforeOddsBySeq.get(event.seq);
    const afterOdds = afterOddsBySeq.get(event.seq);
    if (beforeOdds && afterOdds && canonicalSeries) {
      const eventMovement = strongestComparableMovementForSeries(
        beforeOdds,
        afterOdds,
        fixtureId,
        canonicalSeries,
        resolveTeamOutcome,
        true,
      ) ?? strongestComparableMovementForSeries(
        afterOdds,
        afterOdds,
        fixtureId,
        canonicalSeries,
        resolveTeamOutcome,
        true,
      );
      const signal = participantSignalForSeries(
        beforeOdds,
        afterOdds,
        fixtureId,
        canonicalSeries,
        resolveTeamOutcome,
      ) ?? participantSignalForSeries(
        afterOdds,
        afterOdds,
        fixtureId,
        canonicalSeries,
        resolveTeamOutcome,
      );
      if (eventMovement && signal) {
        eventPulses.push({
          eventSeq: event.seq,
          eventTs: event.ts,
          playbackMs: event.playbackMs,
          minute: event.minute,
          action: event.action,
          participantName: event.participantName,
          movement: eventMovement,
          signal,
        });
      }
    }
  }
  const scoreActions = new Set(["goal", "own_goal", "goal_cancelled"]);
  const scoreEvents = replayEvents.filter((event) => scoreActions.has(event.action));
  const rankedTurningPoints = eventPulses
    .filter((pulse) => scoreActions.has(pulse.action) && pulse.movement.deltaPercentagePoints > 0)
    .map((pulse) => {
      const point = { ...pulse };
      return {
        point,
        index: computeViradaIndex({ events: replayEvents, turningPoint: point, match }),
      };
    })
    .filter((candidate) => (candidate.index?.total ?? 0) >= 60)
    .sort((left, right) =>
      (right.index?.total ?? 0) - (left.index?.total ?? 0) ||
      right.point.movement.deltaPercentagePoints - left.point.movement.deltaPercentagePoints ||
      right.point.eventTs - left.point.eventTs
    );
  const turningPoint = rankedTurningPoints[0]?.point ?? null;
  const factualEvent = turningPoint
    ? replayEvents.find((event) => event.seq === turningPoint.eventSeq) ?? null
    : scoreEvents[scoreEvents.length - 1] ?? null;
  const turningPointReason: ReplayEnvelope["turningPointReason"] = turningPoint
    ? null
    : scoreEvents.length === 0
      ? "no_turning_point"
      : !canonicalSeries
        ? "no_comparable_tuple"
        : scoreEvents.every((event) => eventPulses.some((pulse) => pulse.eventSeq === event.seq))
          ? "no_rare_turning_point"
          : "odds_unavailable";

  let proofState: ReplayEnvelope["provenance"]["state"] = "unavailable";
  let proofEpochDay: number | null = null;
  let dailyScoresPda: string | null = null;
  let proofTargetTs: number | null = null;
  let proofCheckedAt: string | null = null;
  let reason: string | null = null;
  if (!factualEvent) {
    reason = "turning_point_not_unlocked";
  } else if (!factualEvent.score) {
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
        const contextMatches = viewed.proofTargetTs <= factualEvent.ts &&
          (viewed.proofRangeEndTs ?? viewed.proofTargetTs) >= factualEvent.ts;
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

  return {
    schemaVersion: REPLAY_CONTRACT.schemaVersion,
    source: {
      provider: "TxLINE",
      mode: "real_txline",
      network: "devnet",
      fetchedAt: now().toISOString(),
      transformed: true,
      rawPayloadIncluded: false,
      endpoints: aggregateEndpointEvidence(client.evidence),
    },
    match,
    events: replayEvents,
    issues: normalized.issues,
    // Kept under the v1 wire-contract name for compatibility; it now contains
    // real Pulse snapshots for every curated event, not goals alone.
    goalPulses: eventPulses,
    turningPoint,
    turningPointReason,
    provenance: {
      state: proofState,
      network: "devnet",
      programId: TXLINE_PROGRAM_ID,
      fixtureId,
      seq: factualEvent?.seq ?? null,
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
