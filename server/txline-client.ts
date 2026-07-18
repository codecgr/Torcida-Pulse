import type { EndpointEvidence } from "../src/types.js";
import type { ServerConfig } from "./config.js";

export type EndpointId = EndpointEvidence["id"];

export class TxlineRequestError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly upstreamStatus: number | null;

  constructor(code: string, message: string, httpStatus: number, upstreamStatus: number | null = null) {
    super(message);
    this.name = "TxlineRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.upstreamStatus = upstreamStatus;
  }
}

export interface TxlineClient {
  get(path: string, id: EndpointId): Promise<unknown>;
  evidence: EndpointEvidence[];
}

export const MAX_TXLINE_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_FINITE_SSE_RECORDS = 10_000;

async function cancelResponseBody(response: Response | null): Promise<void> {
  if (!response?.body || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort; the request AbortController is the backstop.
  }
}

function isRedirectFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  return /redirect/i.test(error.message) || (cause instanceof Error && /redirect/i.test(cause.message));
}

export async function readResponseBodyLimited(
  response: Response,
  controller: AbortController,
  maxBytes = MAX_TXLINE_RESPONSE_BYTES
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    controller.abort();
    throw new TxlineRequestError(
      "TXLINE_RESPONSE_TOO_LARGE",
      "TxLINE response exceeds the size limit.",
      502,
      response.status
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        try {
          await reader.cancel();
        } finally {
          controller.abort();
        }
        throw new TxlineRequestError(
          "TXLINE_RESPONSE_TOO_LARGE",
          "TxLINE response exceeds the size limit.",
          502,
          response.status
        );
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    if (!(error instanceof TxlineRequestError)) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already have been aborted by the timeout controller.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseFiniteScoreSse(text: string): Record<string, unknown>[] {
  if (Buffer.byteLength(text, "utf8") > MAX_TXLINE_RESPONSE_BYTES) {
    throw new Error("Finite SSE response exceeds the size limit.");
  }
  const records: Record<string, unknown>[] = [];
  const frames = text.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    if (!frame.trim()) continue;
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      if (field !== "data") continue;
      const rawValue = colon === -1 ? "" : line.slice(colon + 1);
      dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (!data.trim()) continue;
    const parsed = JSON.parse(data) as unknown;
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("Finite SSE data is not a score object.");
      }
      records.push(candidate as Record<string, unknown>);
      if (records.length > MAX_FINITE_SSE_RECORDS) {
        throw new Error("Finite SSE response exceeds the record limit.");
      }
    }
  }
  if (records.length === 0) throw new Error("Finite SSE response contains no score objects.");
  return records;
}

async function parseResponse(
  response: Response,
  id: EndpointId,
  controller: AbortController
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await readResponseBodyLimited(response, controller);
  if (!contentType.includes("text/event-stream")) return JSON.parse(text) as unknown;
  if (id !== "scores_historical") throw new Error("Unexpected SSE endpoint.");
  return parseFiniteScoreSse(text);
}

export function createTxlineClient(
  config: ServerConfig,
  fetchImpl: typeof fetch = fetch
): TxlineClient {
  if (!config.guestJwt || !config.apiToken) {
    throw new TxlineRequestError(
      "TXLINE_CREDENTIALS_MISSING",
      "TxLINE devnet credentials are not configured on the server.",
      503
    );
  }
  const guestJwt = config.guestJwt;
  const apiToken = config.apiToken;

  const evidence: EndpointEvidence[] = [];
  return {
    evidence,
    async get(path, id) {
      const started = Date.now();
      let lastStatus: number | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        let response: Response | null = null;
        try {
          response = await fetchImpl(`${config.apiOrigin}/api${path}`, {
            method: "GET",
            redirect: "error",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${guestJwt}`,
              "X-Api-Token": apiToken,
            },
            signal: controller.signal,
          });
          lastStatus = response.status;
          if (response.status >= 300 && response.status < 400) {
            await cancelResponseBody(response);
            evidence.push({ id, status: response.status, durationMs: Date.now() - started });
            throw new TxlineRequestError(
              "TXLINE_REDIRECT_REJECTED",
              "TxLINE redirected an authenticated request.",
              502,
              response.status
            );
          }
          if (response.ok) {
            try {
              const parsed = await parseResponse(response, id, controller);
              evidence.push({ id, status: response.status, durationMs: Date.now() - started });
              return parsed;
            } catch (error) {
              await cancelResponseBody(response);
              if (error instanceof TxlineRequestError) throw error;
              if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
                throw error;
              }
              throw new TxlineRequestError("TXLINE_INVALID_JSON", "TxLINE returned invalid JSON.", 502, response.status);
            }
          }
          const retryable = response.status >= 500;
          await cancelResponseBody(response);
          if (retryable && attempt < 2) continue;
          evidence.push({ id, status: response.status, durationMs: Date.now() - started });
          if (response.status === 401 || response.status === 403) {
            throw new TxlineRequestError("TXLINE_AUTH_FAILED", "TxLINE rejected the server credentials.", 502, response.status);
          }
          throw new TxlineRequestError("TXLINE_UPSTREAM_STATUS", "TxLINE data request failed.", 502, response.status);
        } catch (error) {
          await cancelResponseBody(response);
          if (error instanceof TxlineRequestError) throw error;
          if (isRedirectFetchError(error)) {
            throw new TxlineRequestError(
              "TXLINE_REDIRECT_REJECTED",
              "TxLINE redirected an authenticated request.",
              502,
              lastStatus
            );
          }
          const timeoutError = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
          if (attempt < 2) continue;
          evidence.push({ id, status: 0, durationMs: Date.now() - started });
          throw new TxlineRequestError(
            timeoutError ? "TXLINE_TIMEOUT" : "TXLINE_NETWORK_FAILED",
            timeoutError ? "TxLINE request timed out." : "TxLINE network request failed.",
            502,
            lastStatus
          );
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new TxlineRequestError("TXLINE_NETWORK_FAILED", "TxLINE network request failed.", 502, lastStatus);
    },
  };
}

export function payloadArray(payload: unknown, preferredKeys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of preferredKeys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    if (record.data && typeof record.data === "object") {
      const nested = payloadArray(record.data, preferredKeys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}
