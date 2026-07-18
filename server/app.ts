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
  viteMiddleware?: Connect.Server
) {
  return createServer(async (request, response) => {
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
        json(response, error.httpStatus, {
          error: { code: error.code, message: error.message, upstreamStatus: error.upstreamStatus },
        });
        return;
      }
      json(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } });
    }
  });
}
