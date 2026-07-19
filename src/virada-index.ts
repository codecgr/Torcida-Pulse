import type { ReplayEnvelope, ReplayEvent, ScoreLine, Team } from "./types.js";

export type ViradaTier = "standard" | "classic" | "rare" | "epic" | "legendary";

export interface ViradaIndex {
  total: number;
  tier: ViradaTier;
  components: {
    scoreImportance: number;
    lateness: number;
    comebackSpeed: number;
    txlineShock: number;
  };
}

function normalized(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function eventSide(event: ReplayEvent, participant1: Team, participant2: Team): 1 | 2 | null {
  if (event.participantId === participant1.id || normalized(event.participantName) === normalized(participant1.name)) return 1;
  if (event.participantId === participant2.id || normalized(event.participantName) === normalized(participant2.name)) return 2;
  return null;
}

function scoreDelta(score: ScoreLine | null, side: 1 | 2): number | null {
  if (score?.participant1 === null || score?.participant1 === undefined) return null;
  if (score.participant2 === null || score.participant2 === undefined) return null;
  return side === 1
    ? score.participant1 - score.participant2
    : score.participant2 - score.participant1;
}

function winningSide(score: ScoreLine | null): 1 | 2 | null {
  if (score?.participant1 === null || score?.participant1 === undefined) return null;
  if (score.participant2 === null || score.participant2 === undefined) return null;
  if (score.participant1 === score.participant2) return null;
  return score.participant1 > score.participant2 ? 1 : 2;
}

export function viradaTier(total: number): ViradaTier {
  if (total >= 90) return "legendary";
  if (total >= 80) return "epic";
  if (total >= 70) return "rare";
  if (total >= 60) return "classic";
  return "standard";
}

function scoreImportance(events: ReplayEvent[], point: ReplayEnvelope["turningPoint"]): number {
  if (!point) return 0;
  const pointEvent = events.find(({ seq }) => seq === point.eventSeq);
  const winner = winningSide(pointEvent?.score ?? null);
  const earlier = events.filter(({ playbackMs }) => playbackMs < point.playbackMs);
  if (!winner) {
    const previous = [...earlier].reverse().find(({ score }) => winningSide(score) !== null)?.score ?? null;
    return previous && winningSide(previous) !== null ? 10 : 0;
  }
  if (!winner) return 0;
  if (earlier.some(({ score }) => (scoreDelta(score, winner) ?? 0) < 0)) return 30;
  const previousScore = [...earlier].reverse().find(({ score }) => scoreDelta(score, winner) !== null)?.score ?? null;
  if (!previousScore) return 20;
  if (scoreDelta(previousScore, winner) === 0) return 20;
  return 0;
}

function lateness(minute: number | null): number {
  if (minute === null) return 0;
  if (minute >= 90) return 25;
  if (minute >= 85) return 18;
  if (minute >= 75) return Math.round(((minute - 74) / 10) * 12);
  return 0;
}

function comebackSpeed(
  events: ReplayEvent[],
  point: NonNullable<ReplayEnvelope["turningPoint"]>,
  participant1: Team,
  participant2: Team,
): number {
  const pointEvent = events.find(({ seq }) => seq === point.eventSeq);
  const winner = winningSide(pointEvent?.score ?? null);
  if (!winner) return 0;
  const equalizer = events
    .filter((event) =>
      event.playbackMs < point.playbackMs &&
      ["goal", "own_goal"].includes(event.action) &&
      scoreDelta(event.score, winner) === 0 &&
      eventSide(event, participant1, participant2) === winner
    )
    .sort((left, right) => right.ts - left.ts)[0];
  if (!equalizer) return 0;
  // Match-clock minutes define sporting proximity; delivery timestamps may be
  // delayed, corrected, or compressed by the provider transport.
  const elapsedMinutes = point.minute !== null && equalizer.minute !== null
    ? point.minute - equalizer.minute
    : (point.eventTs - equalizer.ts) / 60_000;
  if (elapsedMinutes >= 0 && elapsedMinutes <= 5) return 20;
  if (elapsedMinutes <= 10) return 12;
  return 0;
}

function txlineShock(before: number, after: number): number {
  const delta = Math.abs(after - before);
  if (delta >= 70) return 25;
  if (delta >= 50) return 18;
  if (delta >= 30) return 12;
  if (delta >= 15) return 6;
  return 0;
}

/** Transparent 100-point rarity score derived only from replay facts and one
 * identical TxLINE outcome tuple around the turning point. */
export function computeViradaIndex(
  replay: Pick<ReplayEnvelope, "events" | "turningPoint" | "match">,
): ViradaIndex | null {
  const point = replay.turningPoint;
  if (!point) return null;
  const components = {
    scoreImportance: scoreImportance(replay.events, point),
    lateness: lateness(point.minute),
    comebackSpeed: comebackSpeed(
      replay.events,
      point,
      replay.match.participant1,
      replay.match.participant2,
    ),
    txlineShock: txlineShock(point.movement.before.pct, point.movement.after.pct),
  };
  const total = Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0));
  return { total, tier: viradaTier(total), components };
}
