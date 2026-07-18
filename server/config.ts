export const TXLINE_DEVNET_ORIGIN = "https://txline-dev.txodds.com";
export const TXLINE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export const FROZEN_FIXTURE_ID = "18241006";
export const FROZEN_START_EPOCH_DAY = 20649;

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
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  };
}

export function credentialsConfigured(config: ServerConfig): boolean {
  return Boolean(config.guestJwt && config.apiToken);
}
