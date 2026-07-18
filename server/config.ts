import { FROZEN_FIXTURE_ID } from "../src/replay-contract.js";

export const TXLINE_DEVNET_ORIGIN = "https://txline-dev.txodds.com";
export const TXLINE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export const FROZEN_START_EPOCH_DAY = 20649;
export { FROZEN_FIXTURE_ID };

export interface ServerConfig {
  port: number;
  apiOrigin: string;
  guestJwt: string | null;
  apiToken: string | null;
  fixtureId: string;
  startEpochDay: number;
  timeoutMs: number;
  rpcUrl: string;
  nodeEnv: string;
  judgeAccessToken?: string | null;
  realDataDisableAt?: number | null;
  replayCacheTtlMs?: number;
  replayRateLimitMax?: number;
  replayRateLimitWindowMs?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalTimestamp(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("REAL_DATA_DISABLE_AT must be an ISO-8601 timestamp.");
  return parsed;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const apiOrigin = (env.TXLINE_API_ORIGIN ?? TXLINE_DEVNET_ORIGIN).replace(/\/$/, "");
  const isLoopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiOrigin);
  if (apiOrigin !== TXLINE_DEVNET_ORIGIN && !(nodeEnv === "test" && isLoopback)) {
    throw new Error("TXLINE_API_ORIGIN must be the official devnet host (loopback is test-only). ");
  }
  const rpcUrl = env.SOLANA_RPC_URL ?? SOLANA_DEVNET_RPC;
  if (rpcUrl !== SOLANA_DEVNET_RPC && !(nodeEnv === "test" && /^http:\/\//.test(rpcUrl))) {
    throw new Error("SOLANA_RPC_URL must be devnet (loopback is test-only). ");
  }
  const judgeAccessToken = env.JUDGE_ACCESS_TOKEN?.trim() || null;
  if (judgeAccessToken && judgeAccessToken.length < 16) {
    throw new Error("JUDGE_ACCESS_TOKEN must contain at least 16 characters.");
  }
  return {
    port: positiveInteger(env.PORT, 4173),
    apiOrigin,
    guestJwt: env.TXLINE_GUEST_JWT?.trim() || null,
    apiToken: env.TXLINE_API_TOKEN?.trim() || null,
    fixtureId: FROZEN_FIXTURE_ID,
    startEpochDay: FROZEN_START_EPOCH_DAY,
    timeoutMs: positiveInteger(env.TXLINE_TIMEOUT_MS, 8_000),
    rpcUrl,
    nodeEnv,
    judgeAccessToken,
    realDataDisableAt: optionalTimestamp(env.REAL_DATA_DISABLE_AT),
    replayCacheTtlMs: positiveInteger(env.REPLAY_CACHE_TTL_MS, 5 * 60_000),
    replayRateLimitMax: positiveInteger(env.REPLAY_RATE_LIMIT_MAX, 30),
    replayRateLimitWindowMs: positiveInteger(env.REPLAY_RATE_LIMIT_WINDOW_MS, 60_000),
  };
}

export function credentialsConfigured(config: ServerConfig): boolean {
  return Boolean(config.guestJwt && config.apiToken);
}
