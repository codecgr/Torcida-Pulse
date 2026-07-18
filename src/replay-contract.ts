import replayManifestJson from "../config/replay-manifest.json" with { type: "json" };

export interface ReplayManifest {
  schemaVersion: 1;
  fixtureId: string;
  startEpochDay: number;
  fixtureStartTime: string;
  historicalEligibleAfter: string;
  historicalEligibleUntil: string;
  rotateBefore: string;
  selectedAt: string;
  expectedRealSmoke: {
    turningPointSeq: number;
    turningPointMinute: number;
    participant1Score: number;
    participant2Score: number;
    beforePct: number;
    afterPct: number;
    proofEpochDay: number;
  };
}

function checkedReplayManifest(value: unknown): Readonly<ReplayManifest> {
  if (!value || typeof value !== "object") throw new Error("Replay manifest must be an object.");
  const manifest = value as Partial<ReplayManifest>;
  const timestamps = [
    manifest.fixtureStartTime,
    manifest.historicalEligibleAfter,
    manifest.historicalEligibleUntil,
    manifest.rotateBefore,
    manifest.selectedAt,
  ];
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.fixtureId !== "string" ||
    !/^\d+$/.test(manifest.fixtureId) ||
    !Number.isInteger(manifest.startEpochDay) ||
    timestamps.some((timestamp) => typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) ||
    !manifest.expectedRealSmoke
  ) {
    throw new Error("Replay manifest is invalid.");
  }
  return Object.freeze(manifest as ReplayManifest);
}

export const REPLAY_MANIFEST = checkedReplayManifest(replayManifestJson);

export const REPLAY_CONTRACT = {
  schemaVersion: "1.0",
  playbackDurationMs: 20_000,
} as const;

export const ACTIVE_REPLAY_FIXTURE_ID = REPLAY_MANIFEST.fixtureId;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Guard JSON fixtures against drifting from the browser/server replay contract. */
export function assertReplayEnvelopeContract(value: unknown): void {
  const replay = record(value);
  if (!replay) throw new Error("Replay fixture must be an object.");
  if (replay.schemaVersion !== REPLAY_CONTRACT.schemaVersion) {
    throw new Error(`Replay schemaVersion must be ${REPLAY_CONTRACT.schemaVersion}.`);
  }
  if (replay.playbackDurationMs !== REPLAY_CONTRACT.playbackDurationMs) {
    throw new Error(`Replay playbackDurationMs must be ${REPLAY_CONTRACT.playbackDurationMs}.`);
  }

  const match = record(replay.match);
  if (!match || typeof match.fixtureId !== "string" || !Number.isFinite(match.startTime)) {
    throw new Error("Replay match must include fixtureId and a finite startTime.");
  }

  if (!Array.isArray(replay.events) || replay.events.length === 0) {
    throw new Error("Replay events must be a non-empty array.");
  }
  const playbackPositions = replay.events.map((candidate) => {
    const event = record(candidate);
    const playbackMs = event?.playbackMs;
    if (
      typeof playbackMs !== "number" ||
      !Number.isFinite(playbackMs) ||
      playbackMs < 0 ||
      playbackMs > REPLAY_CONTRACT.playbackDurationMs
    ) {
      throw new Error("Replay event playbackMs is outside the shared playback contract.");
    }
    return playbackMs;
  });
  if (Math.max(...playbackPositions) !== REPLAY_CONTRACT.playbackDurationMs) {
    throw new Error("Replay events must reach the shared playbackDurationMs.");
  }

  if (replay.turningPoint !== null) {
    const turningPoint = record(replay.turningPoint);
    const playbackMs = turningPoint?.playbackMs;
    if (
      typeof playbackMs !== "number" ||
      !Number.isFinite(playbackMs) ||
      playbackMs < 0 ||
      playbackMs > REPLAY_CONTRACT.playbackDurationMs
    ) {
      throw new Error("Replay turning point is outside the shared playback contract.");
    }
    if (replay.turningPointReason !== null) {
      throw new Error("Replay with a turning point cannot include a turningPointReason.");
    }
  } else if (!["odds_unavailable", "no_comparable_tuple"].includes(String(replay.turningPointReason))) {
    throw new Error("Replay without a turning point must explain its turningPointReason.");
  }
}
