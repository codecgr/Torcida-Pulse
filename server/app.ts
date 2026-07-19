import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Connect } from "vite";
import type { ServerConfig } from "./config.js";
import { credentialsConfigured } from "./config.js";
import { mintLegendaryCollectible, type MintedCollectible } from "./collectible.js";
import { listWorldCupFixtures, WORLD_CUP_START_EPOCH_DAY } from "./fixtures-service.js";
import { buildRealReplay, type ReplayDependencies } from "./replay-service.js";
import { TxlineRequestError } from "./txline-client.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const DIAGNOSTIC_CODES = new Set([
  "BUILD_MISSING",
  "FIXTURE_NOT_FROZEN",
  "FIXTURE_NOT_AVAILABLE",
  "INTERNAL_ERROR",
  "INVALID_PATH",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "JUDGE_ACCESS_NOT_CONFIGURED",
  "JUDGE_ACCESS_REQUIRED",
  "RATE_LIMITED",
  "REAL_DATA_DISABLED",
  "REAL_DATA_WINDOW_NOT_CONFIGURED",
  "TXLINE_AUTH_FAILED",
  "TXLINE_CREDENTIALS_MISSING",
  "TXLINE_EVENT_UNAVAILABLE",
  "TXLINE_FIXTURE_NOT_FOUND",
  "TXLINE_FIXTURE_SCHEMA",
  "TXLINE_INVALID_JSON",
  "TXLINE_NETWORK_FAILED",
  "TXLINE_REDIRECT_REJECTED",
  "TXLINE_RESPONSE_TOO_LARGE",
  "TXLINE_SCORES_EMPTY",
  "TXLINE_TIMEOUT",
  "TXLINE_UPSTREAM_STATUS",
  "COLLECTIBLE_AUTHORITY_MISSING",
  "COLLECTIBLE_MINT_FAILED",
  "INVALID_CLAIM_KEY",
]);
const DIAGNOSTIC_STATUSES = new Set([400, 401, 404, 405, 410, 429, 500, 502, 503]);

export interface ServerDiagnostic {
  requestId: string;
  route: "/api/health" | "/api/live" | "/api/ready" | "/api/replays/:fixtureId" | "/api/*" | "static";
  durationMs: number;
  status: number;
  code: string;
  stack: string[];
}

export type DiagnosticLogger = (diagnostic: ServerDiagnostic) => void;

export interface AppDependencies extends ReplayDependencies {
  mintCollectible?: (metadataUri: string) => Promise<MintedCollectible>;
  listFixtures?: typeof listWorldCupFixtures;
}

function diagnosticRoute(request: IncomingMessage): ServerDiagnostic["route"] {
  let pathname = "/";
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return "static";
  }
  if (["/api/health", "/api/live", "/api/ready"].includes(pathname)) {
    return pathname as ServerDiagnostic["route"];
  }
  if (/^\/api\/replays\/[^/]+$/.test(pathname)) return "/api/replays/:fixtureId";
  if (pathname.startsWith("/api/")) return "/api/*";
  return "static";
}

function diagnosticCode(code: string): string {
  return DIAGNOSTIC_CODES.has(code) ? code : "INTERNAL_ERROR";
}

function diagnosticStatus(status: number): number {
  return DIAGNOSTIC_STATUSES.has(status) ? status : 500;
}

function sanitizedStack(error: unknown): string[] {
  if (!(error instanceof Error) || !error.stack) return [];
  return error.stack.split("\n").slice(1, 6).map((line) => {
    const functionName = line.match(/^\s*at\s+([^\s(]+)/)?.[1] ?? "anonymous";
    const safeFunction = /^[A-Za-z0-9_.<>]+$/.test(functionName) ? functionName : "anonymous";
    const location = line.match(/[/\\]([^/\\():]+:\d+:\d+)\)?$/)?.[1] ?? "redacted";
    return `at ${safeFunction} (${location})`;
  });
}

const defaultDiagnosticLogger: DiagnosticLogger = (diagnostic) => {
  process.stderr.write(`${JSON.stringify({ event: "request_error", ...diagnostic })}\n`);
};

function securityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
}

function secureTokenEquals(expected: string, received: string | string[] | undefined): boolean {
  if (typeof received !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

function realDataConfigurationReason(
  config: ServerConfig,
  now: () => Date
): string | null {
  if (!credentialsConfigured(config)) return "TXLINE_CREDENTIALS_MISSING";
  if (config.nodeEnv !== "production") return null;
  if (!config.realDataDisableAt) return "REAL_DATA_WINDOW_NOT_CONFIGURED";
  if (now().getTime() >= config.realDataDisableAt) return "REAL_DATA_DISABLED";
  if (!config.judgeAccessToken) return "JUDGE_ACCESS_NOT_CONFIGURED";
  return null;
}

function assertRealDataAccess(
  request: IncomingMessage,
  config: ServerConfig,
  now: () => Date
): void {
  if (!credentialsConfigured(config)) {
    throw new TxlineRequestError(
      "TXLINE_CREDENTIALS_MISSING",
      "TxLINE devnet credentials are not configured on the server.",
      503
    );
  }
  if (config.nodeEnv !== "production") return;
  if (!config.realDataDisableAt) {
    throw new TxlineRequestError(
      "REAL_DATA_WINDOW_NOT_CONFIGURED",
      "The real-data shutdown window is not configured.",
      503
    );
  }
  if (now().getTime() >= config.realDataDisableAt) {
    throw new TxlineRequestError("REAL_DATA_DISABLED", "The real-data access window has ended.", 410);
  }
  if (!config.judgeAccessToken) {
    throw new TxlineRequestError(
      "JUDGE_ACCESS_NOT_CONFIGURED",
      "Judge access is not configured on the server.",
      503
    );
  }
  if (!secureTokenEquals(config.judgeAccessToken, request.headers["x-judge-access"])) {
    throw new TxlineRequestError(
      "JUDGE_ACCESS_REQUIRED",
      "A valid judge access code is required for the real replay.",
      401
    );
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const dist = resolve(process.cwd(), "dist");
  const urlPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let file = resolve(dist, relative);
  if (!file.startsWith(`${dist}${sep}`) && file !== resolve(dist, "index.html")) {
    json(response, 400, { error: { code: "INVALID_PATH", message: "Invalid path." } });
    return;
  }
  if (!existsSync(file) || !(await stat(file)).isFile()) file = resolve(dist, "index.html");
  if (!existsSync(file)) {
    json(response, 503, { error: { code: "BUILD_MISSING", message: "Production build is missing." } });
    return;
  }
  securityHeaders(response);
  response.statusCode = 200;
  response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable");
  createReadStream(file).pipe(response);
}

export function createTorcidaServer(
  config: ServerConfig,
  dependencies: AppDependencies = {},
  viteMiddleware?: Connect.Server,
  logDiagnostic: DiagnosticLogger = defaultDiagnosticLogger
) {
  const now = dependencies.now ?? (() => new Date());
  const cacheTtlMs = config.replayCacheTtlMs ?? 5 * 60_000;
  const cachedReplays = new Map<string, { value: Awaited<ReturnType<typeof buildRealReplay>>; expiresAt: number }>();
  const inFlights = new Map<string, Promise<Awaited<ReturnType<typeof buildRealReplay>>>>();
  let cachedCatalog: { value: Awaited<ReturnType<typeof listWorldCupFixtures>>; expiresAt: number } | null = null;
  let catalogInFlight: Promise<Awaited<ReturnType<typeof listWorldCupFixtures>>> | null = null;
  const collectibleClaims = new Map<string, Promise<MintedCollectible>>();
  let lastReadinessFailure = realDataConfigurationReason(config, now);
  const getCatalog = (): Promise<Awaited<ReturnType<typeof listWorldCupFixtures>>> => {
    const nowMs = now().getTime();
    if (cachedCatalog && cachedCatalog.expiresAt > nowMs) return Promise.resolve(cachedCatalog.value);
    if (catalogInFlight) return catalogInFlight;
    const loader = dependencies.listFixtures ?? listWorldCupFixtures;
    const pending = loader(config, dependencies).then((value) => {
      cachedCatalog = { value, expiresAt: now().getTime() + 30_000 };
      return value;
    }).finally(() => {
      if (catalogInFlight === pending) catalogInFlight = null;
    });
    catalogInFlight = pending;
    return pending;
  };
  const getReplay = async (fixtureId: string): Promise<Awaited<ReturnType<typeof buildRealReplay>>> => {
    if (fixtureId !== config.fixtureId) {
      const catalog = await getCatalog();
      if (!catalog.fixtures.some((fixture) => fixture.fixtureId === fixtureId)) {
        throw new TxlineRequestError("FIXTURE_NOT_AVAILABLE", "This fixture is not in the TxLINE World Cup catalog.", 404);
      }
    }
    const nowMs = now().getTime();
    const cachedReplay = cachedReplays.get(fixtureId);
    if (cachedReplay && cachedReplay.expiresAt > nowMs) return cachedReplay.value;
    const existing = inFlights.get(fixtureId);
    if (existing) return existing;
    if (fixtureId === config.fixtureId) lastReadinessFailure = null;
    const targetConfig = fixtureId === config.fixtureId
      ? config
      : { ...config, fixtureId, startEpochDay: WORLD_CUP_START_EPOCH_DAY };
    const pending = buildRealReplay(targetConfig, fixtureId, dependencies)
      .then((value) => {
        const ttl = value.match.status === "live" ? Math.min(cacheTtlMs, 3_000) : cacheTtlMs;
        cachedReplays.set(fixtureId, { value, expiresAt: now().getTime() + ttl });
        if (fixtureId === config.fixtureId) lastReadinessFailure = null;
        return value;
      })
      .catch((error: unknown) => {
        cachedReplays.delete(fixtureId);
        if (fixtureId === config.fixtureId) {
          lastReadinessFailure = error instanceof TxlineRequestError
            ? diagnosticCode(error.code)
            : "INTERNAL_ERROR";
        }
        throw error;
      })
      .finally(() => {
        if (inFlights.get(fixtureId) === pending) inFlights.delete(fixtureId);
      });
    inFlights.set(fixtureId, pending);
    return await pending;
  };

  const rateLimitMax = config.replayRateLimitMax ?? 30;
  const rateLimitWindowMs = config.replayRateLimitWindowMs ?? 60_000;
  let rateWindowStartedAt = Date.now();
  let rateWindowCount = 0;
  const consumeReplayRateLimit = (): number | null => {
    const nowMs = Date.now();
    if (nowMs - rateWindowStartedAt >= rateLimitWindowMs) {
      rateWindowStartedAt = nowMs;
      rateWindowCount = 0;
    }
    if (rateWindowCount >= rateLimitMax) {
      return Math.max(1, Math.ceil((rateLimitWindowMs - (nowMs - rateWindowStartedAt)) / 1000));
    }
    rateWindowCount += 1;
    return null;
  };

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    const route = diagnosticRoute(request);
    response.setHeader("X-Request-Id", requestId);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const isCollectibleClaim = url.pathname === "/api/collectibles/legendary-91/claim";
      if (request.method !== "GET" && !(request.method === "POST" && isCollectibleClaim)) {
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
        return;
      }
      if (url.pathname === "/api/collectibles/legendary-91/metadata") {
        const origin = config.publicAppOrigin ?? `http://localhost:${config.port}`;
        json(response, 200, {
          name: "Torcida Pulse — A Virada Depois da Virada",
          symbol: "TPULSE",
          description: "Legendary Torcida Pulse collectible generated from the verified 91′ lead reversal and the real TxLINE signal swing from 12.9 to 88.7.",
          image: `${origin}/legendary-turning-point.webp`,
          external_url: origin,
          attributes: [
            { trait_type: "Rarity", value: "Legendary" },
            { trait_type: "Fixture", value: config.fixtureId },
            { trait_type: "Moment", value: "91′" },
            { trait_type: "Score", value: "England 1 — 2 Argentina" },
            { trait_type: "Virada Index", value: 92 },
            { trait_type: "TxLINE Signal", value: "12.9 → 88.7" },
            { trait_type: "Artwork", value: "Pre-generated generative AI example" },
          ],
        });
        return;
      }
      if (request.method === "POST" && isCollectibleClaim) {
        assertRealDataAccess(request, config, now);
        const claimKey = request.headers["idempotency-key"];
        if (typeof claimKey !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(claimKey)) {
          throw new TxlineRequestError("INVALID_CLAIM_KEY", "A valid collectible claim key is required.", 400);
        }
        const replay = await getReplay(config.fixtureId);
        if (!replay.turningPoint) {
          throw new TxlineRequestError("COLLECTIBLE_MINT_FAILED", "The verified turning point is unavailable.", 503);
        }
        let claim = collectibleClaims.get(claimKey);
        if (!claim) {
          if (collectibleClaims.size >= 10) {
            throw new TxlineRequestError("RATE_LIMITED", "The collectible demo claim limit was reached.", 429);
          }
          const metadataUri = `${config.publicAppOrigin ?? `http://localhost:${config.port}`}/api/collectibles/legendary-91/metadata`;
          const mint = dependencies.mintCollectible ?? ((uri: string) => {
            if (!config.collectibleAuthoritySecret && !config.collectibleAuthorityPath) {
              throw new TxlineRequestError("COLLECTIBLE_AUTHORITY_MISSING", "The collectible mint authority is not configured.", 503);
            }
            return mintLegendaryCollectible({
              rpcUrl: config.rpcUrl,
              authoritySecret: config.collectibleAuthoritySecret ?? null,
              authorityPath: config.collectibleAuthorityPath ?? null,
            }, uri);
          });
          claim = Promise.resolve().then(() => mint(metadataUri)).catch((error: unknown) => {
            collectibleClaims.delete(claimKey);
            if (error instanceof TxlineRequestError) throw error;
            throw new TxlineRequestError("COLLECTIBLE_MINT_FAILED", "Solana devnet did not confirm the collectible mint.", 502);
          });
          collectibleClaims.set(claimKey, claim);
        }
        json(response, 201, { collectible: await claim });
        return;
      }
      if (url.pathname === "/api/live") {
        json(response, 200, { status: "live" });
        return;
      }
      if (url.pathname === "/api/fixtures") {
        assertRealDataAccess(request, config, now);
        json(response, 200, await getCatalog());
        return;
      }
      if (url.pathname === "/api/ready") {
        const configurationReason = realDataConfigurationReason(config, now);
        const activeCachedReplay = cachedReplays.get(config.fixtureId);
        const cacheReady = !configurationReason && activeCachedReplay && activeCachedReplay.expiresAt > now().getTime();
        if (cacheReady) {
          json(response, 200, { status: "ready", fixtureId: config.fixtureId });
          return;
        }
        if (!configurationReason && !inFlights.has(config.fixtureId) && !lastReadinessFailure) {
          void getReplay(config.fixtureId).catch(() => undefined);
        }
        json(response, 503, {
          status: "not_ready",
          reason: configurationReason ?? lastReadinessFailure ?? "WARMING",
        });
        return;
      }
      if (url.pathname === "/api/health") {
        json(response, 200, {
          status: "ok",
          source: "TxLINE devnet",
          credentialsConfigured: credentialsConfigured(config),
          fixtureId: config.fixtureId,
          rawPayloadsStored: false,
          replayReady: Boolean(cachedReplays.get(config.fixtureId)?.expiresAt && cachedReplays.get(config.fixtureId)!.expiresAt > now().getTime()),
        });
        return;
      }
      const replay = url.pathname.match(/^\/api\/replays\/(\d+)$/);
      if (replay) {
        assertRealDataAccess(request, config, now);
        const retryAfter = consumeReplayRateLimit();
        if (retryAfter !== null) {
          response.setHeader("Retry-After", String(retryAfter));
          throw new TxlineRequestError("RATE_LIMITED", "Too many real replay requests.", 429);
        }
        json(response, 200, await getReplay(replay[1]));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        json(response, 404, { error: { code: "NOT_FOUND", message: "API route not found." } });
        return;
      }
      if (viteMiddleware) {
        viteMiddleware(request, response, () => {
          if (!response.writableEnded) json(response, 404, { error: { code: "NOT_FOUND", message: "Page not found." } });
        });
        return;
      }
      await serveStatic(request, response);
    } catch (error) {
      if (response.writableEnded) return;
      if (error instanceof TxlineRequestError) {
        logDiagnostic({
          requestId,
          route,
          durationMs: Date.now() - started,
          status: diagnosticStatus(error.httpStatus),
          code: diagnosticCode(error.code),
          stack: sanitizedStack(error),
        });
        json(response, error.httpStatus, {
          error: { code: error.code, message: error.message, upstreamStatus: error.upstreamStatus },
        });
        return;
      }
      logDiagnostic({
        requestId,
        route,
        durationMs: Date.now() - started,
        status: 500,
        code: "INTERNAL_ERROR",
        stack: sanitizedStack(error),
      });
      json(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } });
    }
  });
  server.once("listening", () => {
    if (!realDataConfigurationReason(config, now)) void getReplay(config.fixtureId).catch(() => undefined);
  });
  return server;
}
