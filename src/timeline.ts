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
  const participantId = text(
    nested(data, "Participant") ?? nested(data, "participant")
  );
  const participantName =
    participantId === match.participant1.id
      ? match.participant1.name
      : participantId === match.participant2.id
        ? match.participant2.name
        : null;
  const messageId = text(raw.MessageId ?? raw.messageId);

  return {
    id: messageId ? `${seq}:${messageId}` : `${seq}:${ts}:${action}`,
    fixtureId: text(raw.fixtureId ?? raw.FixtureId) ?? match.fixtureId,
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
  const firstTs = chosen[0]?.ts ?? match.startTime;
  const lastTs = chosen.length > 0 ? chosen[chosen.length - 1].ts : firstTs;
  const span = Math.max(1, lastTs - firstTs);
  for (const event of chosen) {
    event.playbackMs = Math.max(0, Math.min(
      REPLAY_CONTRACT.playbackDurationMs,
      Math.round(((event.ts - firstTs) / span) * REPLAY_CONTRACT.playbackDurationMs)
    ));
  }
  return { events: chosen, issues };
}

const REPLAY_MILESTONES = new Set([
  "kickoff",
  "kick_off",
  "goal",
  "yellow_card",
  "red_card",
  "penalty",
  "var_end",
  "halftime_finalised",
  "game_finalised",
]);

function completeScoreKey(event: ReplayEvent): string | null {
  if (event.score?.participant1 === null || event.score?.participant2 === null || !event.score) return null;
  return `${event.score.participant1}:${event.score.participant2}`;
}

/** Reduce delivery-level telemetry to the milestones a fan can scan. */
export function curateReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq || left.ts - right.ts);
  let lastGoalScore = ordered.map(completeScoreKey).find((value) => value !== null) ?? null;
  let kickoffIncluded = false;
  let halftimeIncluded = false;
  const seenMilestones = new Set<string>();
  const curated: ReplayEvent[] = [];

  for (const event of ordered) {
    if (!REPLAY_MILESTONES.has(event.action)) continue;
    if (event.action === "kickoff" || event.action === "kick_off") {
      if (kickoffIncluded) continue;
      kickoffIncluded = true;
    } else if (event.action === "halftime_finalised") {
      if (halftimeIncluded) continue;
      halftimeIncluded = true;
    } else if (event.action === "goal") {
      const scoreKey = completeScoreKey(event);
      if (!scoreKey || scoreKey === lastGoalScore) continue;
      lastGoalScore = scoreKey;
    } else {
      const key = [event.action, event.minute, event.participantId, completeScoreKey(event)].join(":");
      if (seenMilestones.has(key)) continue;
      seenMilestones.add(key);
    }
    curated.push({ ...event });
  }

  if (curated.length === 0 && ordered.length > 0) curated.push({ ...ordered[0] });
  const firstTs = curated[0]?.ts ?? 0;
  const lastTs = curated[curated.length - 1]?.ts ?? firstTs;
  const span = Math.max(1, lastTs - firstTs);
  for (const event of curated) {
    event.playbackMs = Math.max(0, Math.min(
      REPLAY_CONTRACT.playbackDurationMs,
      Math.round(((event.ts - firstTs) / span) * REPLAY_CONTRACT.playbackDurationMs)
    ));
  }
  return curated;
}

export function visibleAt(events: ReplayEvent[], playheadMs: number): ReplayEvent[] {
  return events.filter((event) => event.playbackMs <= playheadMs);
}

export function scoreAt(events: ReplayEvent[], playheadMs: number): ScoreLine | null {
  return [...visibleAt(events, playheadMs)].reverse().find((event) => event.score)?.score ?? null;
}
