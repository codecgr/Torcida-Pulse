/** Public, normalized interface shared by the server and browser. */

import type { REPLAY_CONTRACT } from "./replay-contract.js";

export type SourceMode = "real_txline";
export type ProvenanceState =
  | "verified"
  | "unavailable"
  | "failed";

export interface EndpointEvidence {
  id:
    | "fixtures_snapshot"
    | "scores_historical"
    | "scores_snapshot"
    | "odds_before"
    | "odds_after"
    | "odds_live"
    | "scores_stat_validation";
  status: number;
  durationMs: number;
}

export interface ReplaySource {
  provider: "TxLINE";
  mode: SourceMode;
  network: "devnet" | "none";
  fetchedAt: string;
  transformed: true;
  rawPayloadIncluded: false;
  endpoints: EndpointEvidence[];
}

export interface Team {
  id: string;
  name: string;
  side: "participant1" | "participant2";
}

export interface ReplayMatch {
  fixtureId: string;
  competition: string | null;
  startTime: number;
  participant1: Team;
  participant2: Team;
  participant1IsHome: boolean | null;
  status?: "scheduled" | "live" | "finished";
}

export interface ScoreLine {
  participant1: number | null;
  participant2: number | null;
}

export interface ReplayEvent {
  id: string;
  fixtureId: string;
  seq: number;
  ts: number;
  action: string;
  minute: number | null;
  participantId: string | null;
  participantName: string | null;
  phase: string | null;
  score: ScoreLine | null;
  corrected: boolean;
  playbackMs: number;
}

export interface NormalizationIssue {
  code: "missing_field" | "fixture_mismatch" | "duplicate" | "seq_conflict" | "correction";
  seq: number | null;
  detail: string;
}

export interface MarketTuple {
  bookmakerId: string;
  superOddsType: string;
  marketPeriod: string | null;
  marketParameters: string | null;
  priceName: string;
}

export type MarketSeriesTuple = Omit<MarketTuple, "priceName">;

export interface MarketPoint {
  ts: number;
  pct: number;
}

export interface MarketMovement {
  tuple: MarketTuple;
  before: MarketPoint;
  after: MarketPoint;
  deltaPercentagePoints: number;
  direction: "up" | "down";
}

export interface ParticipantSignalPoint {
  ts: number;
  /** Raw TxLINE 1X2 percentage for participant 1. */
  participant1Pct: number;
  /** Raw TxLINE 1X2 percentage for participant 2. */
  participant2Pct: number;
  /** Two-team share: p1 / (p1 + p2). The draw is not assigned to either side. */
  participant1Share: number;
}

export interface ParticipantSignal {
  /** One immutable bookmaker/type/period/parameters series for the whole replay. */
  tuple: MarketSeriesTuple;
  before: ParticipantSignalPoint;
  after: ParticipantSignalPoint;
  deltaPercentagePoints: number;
  direction: "participant1" | "participant2" | "flat";
}

export interface PulseMoment {
  eventSeq: number;
  eventTs: number;
  playbackMs: number;
  minute: number | null;
  action: string;
  participantName: string | null;
  movement: MarketMovement;
  /** Canonical full-match 1X2 signal used by the live Pulse and thermometer. */
  signal?: ParticipantSignal;
}

export interface TurningPoint extends PulseMoment {}

export interface Provenance {
  state: ProvenanceState;
  network: "devnet" | "none";
  programId: string | null;
  fixtureId: string;
  seq: number | null;
  statKeys: number[];
  epochDay: number | null;
  dailyScoresPda: string | null;
  proofTargetTs: number | null;
  checkedAt: string | null;
  reason: string | null;
}

export interface ReplayEnvelope {
  schemaVersion: typeof REPLAY_CONTRACT.schemaVersion;
  source: ReplaySource;
  match: ReplayMatch;
  events: ReplayEvent[];
  issues: NormalizationIssue[];
  goalPulses: PulseMoment[];
  turningPoint: TurningPoint | null;
  turningPointReason:
    | "odds_unavailable"
    | "no_comparable_tuple"
    | "no_turning_point"
    | "no_rare_turning_point"
    | null;
  provenance: Provenance;
  playbackDurationMs: typeof REPLAY_CONTRACT.playbackDurationMs;
}

export interface FixtureCatalogEntry {
  fixtureId: string;
  competition: string;
  startTime: number;
  participant1: string;
  participant2: string;
  status: "scheduled" | "live" | "finished";
}

export interface FixtureCatalogEnvelope {
  source: "TxLINE";
  fetchedAt: string;
  competition: "World Cup";
  fixtures: FixtureCatalogEntry[];
}

/** Minimal raw TxLINE shapes. They stay server-side and are never returned. */
export interface RawFixture {
  FixtureId?: unknown;
  fixtureId?: unknown;
  Participant1?: unknown;
  Participant2?: unknown;
  Participant1Id?: unknown;
  Participant2Id?: unknown;
  Participant1IsHome?: unknown;
  StartTime?: unknown;
  startTime?: unknown;
  Competition?: unknown;
  CompetitionName?: unknown;
  GameState?: unknown;
  [key: string]: unknown;
}

export interface RawScoreEvent {
  FixtureId?: unknown;
  fixtureId?: unknown;
  Seq?: unknown;
  seq?: unknown;
  Ts?: unknown;
  ts?: unknown;
  Action?: unknown;
  action?: unknown;
  GameState?: unknown;
  gameState?: unknown;
  Clock?: unknown;
  clock?: unknown;
  ScoreSoccer?: unknown;
  scoreSoccer?: unknown;
  Score?: unknown;
  score?: unknown;
  Stats?: unknown;
  stats?: unknown;
  DataSoccer?: unknown;
  dataSoccer?: unknown;
  Data?: unknown;
  data?: unknown;
  Participant?: unknown;
  participant?: unknown;
  MessageId?: unknown;
  messageId?: unknown;
  [key: string]: unknown;
}

export interface RawOddsPayload {
  FixtureId?: unknown;
  fixtureId?: unknown;
  MessageId?: unknown;
  messageId?: unknown;
  Ts?: unknown;
  ts?: unknown;
  Bookmaker?: unknown;
  BookmakerId?: unknown;
  SuperOddsType?: unknown;
  MarketParameters?: unknown;
  MarketPeriod?: unknown;
  PriceNames?: unknown;
  Prices?: unknown;
  Pct?: unknown;
  [key: string]: unknown;
}

export interface RawValidationPayload {
  summary?: unknown;
  subTreeProof?: unknown;
  mainTreeProof?: unknown;
  eventStatRoot?: unknown;
  statsToProve?: unknown;
  statProofs?: unknown;
  [key: string]: unknown;
}
