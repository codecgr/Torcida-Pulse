import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Connect } from "vite";
import type { ServerConfig } from "./config.js";
import { credentialsConfigured } from "./config.js";
import { loadSyntheticReplay, buildRealReplay, type ReplayDependencies } from "./replay-service.js";
import { TxlineRequestError } from "./txline-client.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const DIAGNOSTIC_CODES = new Set([
  "BUILD_MISSING",
  "FIXTURE_NOT_FROZEN",
  "INTERNAL_ERROR",
  "INVALID_PATH",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "TXLINE_AUTH_FAILED",
  "TXLINE_CREDENTIALS_MISSING",
  "TXLINE_EVENT_UNAVAILABLE",
  "TXLINE_FIXTURE_NOT_FOUND",
  "TXLINE_FIXTURE_SCHEMA",
  "TXLINE_INVALID_JSON",
  "TXLINE_NETWORK_FAILED",
  "TXLINE_RESPONSE_TOO_LARGE",
  "TXLINE_SCORES_EMPTY",
  "TXLINE_TIMEOUT",
  "TXLINE_UPSTREAM_STATUS",
]);
const DIAGNOSTIC_STATUSES = new Set([400, 404, 405, 500, 502, 503]);

export interface ServerDiagnostic {
  requestId: string;
  route: "/api/health" | "/api/demo" | "/api/replays/:fixtureId" | "/api/*" | "static";
  durationMs: number;
  status: number;
  code: string;
  stack: string[];
}

export type DiagnosticLogger = (diagnostic: ServerDiagnostic) => void;

function diagnosticRoute(request: IncomingMessage): ServerDiagnostic["route"] {
  let pathname = "/";
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return "static";
  }
  if (pathname === "/api/health" || pathname === "/api/demo") return pathname;
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
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
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
  dependencies: ReplayDependencies = {},
  viteMiddleware?: Connect.Server,
  logDiagnostic: DiagnosticLogger = defaultDiagnosticLogger
) {
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    const route = diagnosticRoute(request);
    response.setHeader("X-Request-Id", requestId);
    try {
      if (request.method !== "GET") {
        json(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/health") {
        json(response, 200, {
          status: "ok",
          source: "TxLINE devnet",
          credentialsConfigured: credentialsConfigured(config),
          fixtureId: config.fixtureId,
          rawPayloadsStored: false,
        });
        return;
      }
      if (url.pathname === "/api/demo") {
        json(response, 200, await loadSyntheticReplay(dependencies.now));
        return;
      }
      const replay = url.pathname.match(/^\/api\/replays\/(\d+)$/);
      if (replay) {
        json(response, 200, await buildRealReplay(config, replay[1], dependencies));
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
}
