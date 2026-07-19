import type {
  NormalizationIssue,
  RawScoreEvent,
  ReplayEvent,
  ReplayMatch,
  ScoreLine,
} from "./types.js";
import { REPLAY_CONTRACT } from "./replay-contract.js";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nested(source: unknown, ...path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    const record = object(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}

function scoreLine(raw: RawScoreEvent): ScoreLine | null {
  const score = raw.scoreSoccer ?? raw.ScoreSoccer ?? raw.score ?? raw.Score;
  const stats = raw.stats ?? raw.Stats;
  const nestedParticipant1 = finiteNumber(
    nested(score, "Participant1", "Total", "Goals") ??
      nested(score, "participant1", "total", "goals")
  );
  const nestedParticipant2 = finiteNumber(
    nested(score, "Participant2", "Total", "Goals") ??
      nested(score, "participant2", "total", "goals")
  );
  // Live historical frames expose sparse Score updates but a complete official
  // stat-key map. Keys 1 and 2 are the same positions requested by the proof.
  const participant1 = finiteNumber(nested(stats, "1")) ?? nestedParticipant1;
  const participant2 = finiteNumber(nested(stats, "2")) ?? nestedParticipant2;
  if (participant1 === null && participant2 === null) return null;
  return { participant1, participant2 };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = object(value);
  if (record) {
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function rawIdentity(raw: RawScoreEvent): string {
  return canonical({
    seq: raw.seq ?? raw.Seq,
    ts: raw.ts ?? raw.Ts,
    action: raw.action ?? raw.Action,
    scoreSoccer: raw.scoreSoccer ?? raw.ScoreSoccer ?? raw.score ?? raw.Score,
    stats: raw.stats ?? raw.Stats,
    clock: raw.clock ?? raw.Clock,
    participant: raw.participant ?? raw.Participant,
    dataSoccer: raw.dataSoccer ?? raw.DataSoccer ?? raw.data ?? raw.Data,
  });
}

function normalizeOne(raw: RawScoreEvent, match: ReplayMatch): ReplayEvent | null {
  const seq = finiteNumber(raw.seq ?? raw.Seq);
  const ts = finiteNumber(raw.ts ?? raw.Ts);
  const action = text(raw.action ?? raw.Action);
  if (seq === null || !Number.isInteger(seq) || seq < 1 || ts === null || !action) {
    return null;
  }

  const data = raw.dataSoccer ?? raw.DataSoccer ?? raw.data ?? raw.Data;
  const dataMinute = finiteNumber(
    nested(data, "Minutes") ?? nested(data, "minutes") ?? nested(data, "Minute")
  );
  const clockSeconds = finiteNumber(
    nested(raw.Clock, "Seconds") ?? nested(raw.clock, "seconds")
  );
  const minute = dataMinute !== null
    ? dataMinute
    : clockSeconds !== null
      ? Math.max(0, Math.floor(clockSeconds / 60))
      : null;
  const participantToken = text(
    raw.participant ?? raw.Participant ?? nested(data, "Participant") ?? nested(data, "participant")
  );
  const participant = participantToken === "1" || participantToken === match.participant1.id
    ? match.participant1
    : participantToken === "2" || participantToken === match.participant2.id
      ? match.participant2
      : null;
  const participantId = participant?.id ?? participantToken;
  const participantName = participant?.name ?? null;
  const messageId = text(raw.MessageId ?? raw.messageId);

  return {
    id: messageId ? `${seq}:${messageId}` : `${seq}:${ts}:${action}`,
    fixtureId: match.fixtureId,
    seq,
    ts,
    action: action.toLowerCase(),
    minute,
    participantId,
    participantName,
    phase: text(raw.gameState ?? raw.GameState),
    score: scoreLine(raw),
    corrected: false,
    playbackMs: 0,
  };
}

export function normalizeScoreEvents(
  rawEvents: RawScoreEvent[],
  match: ReplayMatch
): { events: ReplayEvent[]; issues: NormalizationIssue[] } {
  const issues: NormalizationIssue[] = [];
  const grouped = new Map<number, Array<{ raw: RawScoreEvent; event: ReplayEvent }>>();

  for (const raw of rawEvents) {
    const rawFixtureId = text(raw.fixtureId ?? raw.FixtureId);
    if (rawFixtureId !== match.fixtureId) {
      issues.push({
        code: "fixture_mismatch",
        seq: finiteNumber(raw.seq ?? raw.Seq),
        detail: "Ignored score row not explicitly bound to the selected fixture.",
      });
      continue;
    }
    const event = normalizeOne(raw, match);
    if (!event) {
      issues.push({ code: "missing_field", seq: finiteNumber(raw.seq ?? raw.Seq), detail: "Ignored score row without valid seq, ts, or action." });
      continue;
    }
    const group = grouped.get(event.seq) ?? [];
    group.push({ raw, event });
    grouped.set(event.seq, group);
    if (event.action === "amend" || event.action === "correction") {
      issues.push({ code: "correction", seq: event.seq, detail: "TxLINE emitted an explicit correction event." });
    }
  }

  const chosen: ReplayEvent[] = [];
  for (const [seq, rows] of grouped) {
    const identities = new Set(rows.map(({ raw }) => rawIdentity(raw)));
    const duplicateCount = rows.length - identities.size;
    if (duplicateCount > 0) {
      issues.push({ code: "duplicate", seq, detail: `Collapsed ${duplicateCount} identical delivery duplicate(s).` });
    }
    if (identities.size > 1) {
      issues.push({ code: "seq_conflict", seq, detail: `Surfaced ${identities.size} conflicting variants; selected latest timestamp deterministically.` });
    }
    const winner = [...rows].sort((a, b) => {
      if (a.event.ts !== b.event.ts) return b.event.ts - a.event.ts;
      return rawIdentity(b.raw).localeCompare(rawIdentity(a.raw));
    })[0].event;
    winner.corrected = identities.size > 1;
    chosen.push(winner);
  }

  chosen.sort((a, b) => a.seq - b.seq || a.ts - b.ts || a.id.localeCompare(b.id));
  let lastKnownMinute: number | null = null;
  for (const event of chosen) {
    if (event.minute === null) {
      if (event.action === "kickoff" || event.action === "kick_off") event.minute = 0;
      else if (event.action === "halftime_finalised") event.minute = 45;
      else if (event.action === "game_finalised") event.minute = Math.max(90, lastKnownMinute ?? 90);
    }
    if (event.minute !== null) lastKnownMinute = Math.max(lastKnownMinute ?? 0, event.minute);
  }
  const projectedTimestamps: number[] = [];
  for (const event of chosen) {
    const previous = projectedTimestamps.length > 0
      ? projectedTimestamps[projectedTimestamps.length - 1]
      : undefined;
    projectedTimestamps.push(previous === undefined ? event.ts : Math.max(event.ts, previous + 1));
  }
  if (chosen.length > 0) {
    const origin = Math.min(match.startTime, projectedTimestamps[0]);
    const span = Math.max(1, projectedTimestamps[projectedTimestamps.length - 1] - origin);
    let previousPlayback = -1;
    chosen.forEach((event, index) => {
      const remaining = chosen.length - index - 1;
      const latestAllowed = Math.max(0, REPLAY_CONTRACT.playbackDurationMs - remaining);
      const kickoff = index === 0 && (event.action === "kickoff" || event.action === "kick_off");
      const projected = Math.round(
        ((projectedTimestamps[index] - origin) / span) * REPLAY_CONTRACT.playbackDurationMs
      );
      const earliestAllowed = kickoff ? 0 : Math.max(1, previousPlayback + 1);
      event.playbackMs = kickoff
        ? 0
        : Math.min(latestAllowed, Math.max(earliestAllowed, projected));
      previousPlayback = event.playbackMs;
    });
    chosen[chosen.length - 1].playbackMs = REPLAY_CONTRACT.playbackDurationMs;
  }
  return { events: chosen, issues };
}

const REPLAY_MILESTONES = new Set([
  "kickoff",
  "kick_off",
  "goal",
  "own_goal",
  "goal_cancelled",
  "yellow_card",
  "red_card",
  "penalty",
  "penalty_missed",
  "shot_on_target",
  "shot",
  "corner",
  "free_kick",
  "throw_in",
  "possession",
  "attack_possession",
  "safe_possession",
  "substitution",
  "offside",
  "injury",
  "var_start",
  "var_end",
  "period_start",
  "period_end",
  "halftime_finalised",
  "game_finalised",
]);

const CORE_REPLAY_MILESTONES = new Set([
  "kickoff",
  "kick_off",
  "goal",
  "own_goal",
  "goal_cancelled",
  "yellow_card",
  "red_card",
  "penalty",
  "penalty_missed",
  "var_start",
  "var_end",
  "halftime_finalised",
  "game_finalised",
]);
const MAX_REPLAY_EVENTS = 16;
const HIGH_FREQUENCY_MILESTONES = new Set([
  "shot_on_target",
  "shot",
  "corner",
  "free_kick",
  "throw_in",
  "possession",
  "attack_possession",
  "safe_possession",
  "substitution",
  "offside",
  "injury",
]);

function balancedReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  if (events.length <= MAX_REPLAY_EVENTS) return events;
  const selected = new Set(events.filter((event) => CORE_REPLAY_MILESTONES.has(event.action)));
  const optionalByAction = new Map<string, ReplayEvent[]>();
  for (const event of events) {
    if (selected.has(event)) continue;
    const group = optionalByAction.get(event.action) ?? [];
    group.push(event);
    optionalByAction.set(event.action, group);
  }
  while (selected.size < MAX_REPLAY_EVENTS) {
    let added = false;
    for (const group of optionalByAction.values()) {
      const event = group.shift();
      if (!event) continue;
      selected.add(event);
      added = true;
      if (selected.size >= MAX_REPLAY_EVENTS) break;
    }
    if (!added) break;
  }
  return events.filter((event) => selected.has(event));
}

function completeScoreKey(event: ReplayEvent): string | null {
  if (event.score?.participant1 === null || event.score?.participant2 === null || !event.score) return null;
  return `${event.score.participant1}:${event.score.participant2}`;
}

/** Reduce delivery-level telemetry to the milestones a fan can scan. */
export function curateReplayEvents(
  events: ReplayEvent[],
  options: { rebaseToWindow?: boolean } = {},
): ReplayEvent[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq || left.ts - right.ts);
  let lastGoalScore = ordered
    .filter((event) => event.action === "kickoff" || event.action === "kick_off" || completeScoreKey(event) === "0:0")
    .map(completeScoreKey)
    .find((value) => value !== null) ?? null;
  let kickoffIncluded = false;
  let halftimeIncluded = false;
  const seenMilestones = new Set<string>();
  let curated: ReplayEvent[] = [];

  for (const event of ordered) {
    if (!REPLAY_MILESTONES.has(event.action)) continue;
    if (event.action === "kickoff" || event.action === "kick_off") {
      if (kickoffIncluded) continue;
      kickoffIncluded = true;
    } else if (event.action === "halftime_finalised") {
      if (halftimeIncluded) continue;
      halftimeIncluded = true;
    } else if (["goal", "own_goal", "goal_cancelled"].includes(event.action)) {
      const scoreKey = completeScoreKey(event);
      if (!scoreKey || scoreKey === lastGoalScore) continue;
      lastGoalScore = scoreKey;
    } else {
      const key = HIGH_FREQUENCY_MILESTONES.has(event.action)
        ? [event.action, event.minute, event.participantName ?? event.participantId].join(":")
        : [event.action, event.minute, event.participantId, completeScoreKey(event)].join(":");
      if (seenMilestones.has(key)) continue;
      seenMilestones.add(key);
    }
    curated.push({ ...event });
  }

  if (curated.length === 0 && ordered.length > 0) curated.push({ ...ordered[0] });
  curated = balancedReplayEvents(curated);
  const firstPlayback = curated[0]?.playbackMs ?? 0;
  const lastPlayback = curated[curated.length - 1]?.playbackMs ?? 0;
  const startsAtKickoff = curated[0]?.action === "kickoff" || curated[0]?.action === "kick_off";
  const anchorsAtWindowStart = startsAtKickoff || options.rebaseToWindow === true;
  const playbackOrigin = anchorsAtWindowStart ? firstPlayback : 0;
  const playbackSpan = Math.max(1, lastPlayback - playbackOrigin);
  const firstMinute = curated[0]?.minute;
  const lastMinute = curated[curated.length - 1]?.minute;
  const minuteOrigin = anchorsAtWindowStart && firstMinute !== null && firstMinute !== undefined ? firstMinute : 0;
  const hasMonotonicMatchClock = lastMinute !== null && lastMinute !== undefined && lastMinute > minuteOrigin &&
    curated.every((event, index) => event.minute !== null && (
      index === 0 || event.minute >= (curated[index - 1].minute ?? Number.POSITIVE_INFINITY)
    ));
  const matchMinuteSpan = hasMonotonicMatchClock ? lastMinute - minuteOrigin : 0;
  if (curated.length > 0) {
    let previousPlayback = -1;
    curated.forEach((event, index) => {
      const remaining = curated.length - index - 1;
      const latestAllowed = Math.max(0, REPLAY_CONTRACT.playbackDurationMs - remaining);
      const kickoff = index === 0 && (event.action === "kickoff" || event.action === "kick_off");
      const windowStart = index === 0 && options.rebaseToWindow === true;
      // The 20-second replay is a linear compression of the recorded match
      // clock. Multiplying playbackMs / duration by matchMinuteSpan recovers
      // the source minute; delivery seq/timestamps are only a fallback.
      const scaled = hasMonotonicMatchClock && event.minute !== null
        ? ((event.minute - minuteOrigin) / matchMinuteSpan) * REPLAY_CONTRACT.playbackDurationMs
        : lastPlayback > playbackOrigin
          ? Math.round(((event.playbackMs - playbackOrigin) / playbackSpan) * REPLAY_CONTRACT.playbackDurationMs)
          : Math.round(((index + 1) / curated.length) * REPLAY_CONTRACT.playbackDurationMs);
      const earliestAllowed = kickoff || windowStart ? 0 : Math.max(1, previousPlayback + 1);
      event.playbackMs = kickoff || windowStart
        ? 0
        : Math.min(latestAllowed, Math.max(earliestAllowed, scaled));
      previousPlayback = event.playbackMs;
    });
    if (curated.length > 1 || options.rebaseToWindow !== true) {
      curated[curated.length - 1].playbackMs = REPLAY_CONTRACT.playbackDurationMs;
    }
  }
  return curated;
}

export function visibleAt(events: ReplayEvent[], playheadMs: number): ReplayEvent[] {
  return events.filter((event) => event.playbackMs <= playheadMs);
}

export function scoreAt(events: ReplayEvent[], playheadMs: number): ScoreLine | null {
  const visible = visibleAt(events, playheadMs);
  let participant1: number | null = null;
  let participant2: number | null = null;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const score = visible[index].score;
    if (participant1 === null && score?.participant1 !== null && score?.participant1 !== undefined) {
      participant1 = score.participant1;
    }
    if (participant2 === null && score?.participant2 !== null && score?.participant2 !== undefined) {
      participant2 = score.participant2;
    }
    if (participant1 !== null && participant2 !== null) break;
  }
  const startedAtKickoff = visible.some((event) => event.action === "kickoff" || event.action === "kick_off");
  if (startedAtKickoff) {
    participant1 ??= 0;
    participant2 ??= 0;
  }
  return participant1 === null && participant2 === null ? null : { participant1, participant2 };
}
