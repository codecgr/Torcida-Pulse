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

const MAX_FINITE_SSE_BYTES = 16 * 1024 * 1024;
const MAX_FINITE_SSE_RECORDS = 10_000;

function parseFiniteScoreSse(text: string): Record<string, unknown>[] {
  if (Buffer.byteLength(text, "utf8") > MAX_FINITE_SSE_BYTES) {
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

async function parseResponse(response: Response, id: EndpointId): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream")) return response.json();
  if (id !== "scores_historical") throw new Error("Unexpected SSE endpoint.");
  return parseFiniteScoreSse(await response.text());
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
        try {
          const response = await fetchImpl(`${config.apiOrigin}/api${path}`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${guestJwt}`,
              "X-Api-Token": apiToken,
            },
            signal: controller.signal,
          });
          lastStatus = response.status;
          if (response.ok) {
            evidence.push({ id, status: response.status, durationMs: Date.now() - started });
            try {
              return await parseResponse(response, id);
            } catch {
              throw new TxlineRequestError("TXLINE_INVALID_JSON", "TxLINE returned invalid JSON.", 502, response.status);
            }
          }
          const retryable = response.status >= 500;
          if (retryable && attempt < 2) continue;
          evidence.push({ id, status: response.status, durationMs: Date.now() - started });
          if (response.status === 401 || response.status === 403) {
            throw new TxlineRequestError("TXLINE_AUTH_FAILED", "TxLINE rejected the server credentials.", 502, response.status);
          }
          throw new TxlineRequestError("TXLINE_UPSTREAM_STATUS", "TxLINE data request failed.", 502, response.status);
        } catch (error) {
          if (error instanceof TxlineRequestError) throw error;
          const timeoutError = error instanceof Error && error.name === "AbortError";
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
