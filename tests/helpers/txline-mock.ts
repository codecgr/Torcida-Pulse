import { createServer } from "node:http";
import scenario from "../fixtures/txline-contract-scenario.json";

export interface SeenRequest {
  path: string;
  authorization: string | undefined;
  apiToken: string | undefined;
}

export async function startTxlineMock(options: {
  responseStatus?: number;
  failFirstPath?: string;
  delayMs?: number;
  delayMsByPath?: Record<string, number>;
  expectedJwt?: string;
  expectedApiToken?: string;
  scoresAsSse?: boolean;
  responseStatusByPath?: Record<string, number>;
} = {}) {
  const seen: SeenRequest[] = [];
  const attempts = new Map<string, number>();
  const expectedJwt = options.expectedJwt ?? "contract-jwt";
  const expectedApiToken = options.expectedApiToken ?? "txoracle_api_contract_only";
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    seen.push({
      path,
      authorization: request.headers.authorization,
      apiToken: request.headers["x-api-token"] as string | undefined,
    });
    const delayMs = options.delayMsByPath?.[path] ?? options.delayMs;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (request.headers.authorization !== `Bearer ${expectedJwt}` || request.headers["x-api-token"] !== expectedApiToken) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: "test auth rejected" }));
      return;
    }
    const attempt = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, attempt);
    if (options.failFirstPath === path && attempt === 1) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "fictional transient" }));
      return;
    }
    const forcedStatus = options.responseStatusByPath?.[path] ?? options.responseStatus;
    if (forcedStatus) {
      response.statusCode = forcedStatus;
      response.end(JSON.stringify({ error: "fictional forced status" }));
      return;
    }
    let body: unknown;
    if (path === "/api/fixtures/snapshot?startEpochDay=20649") body = [scenario.fixture];
    else if (path === "/api/scores/historical/18241006") body = scenario.scores;
    else if (path === "/api/odds/snapshot/18241006?asOf=1784142780000") body = scenario.oddsFirstBefore;
    else if (path === "/api/odds/snapshot/18241006?asOf=1784143020000") body = scenario.oddsFirstAfter;
    else if (path === "/api/odds/snapshot/18241006?asOf=1784143380000") body = scenario.oddsBefore;
    else if (path === "/api/odds/snapshot/18241006?asOf=1784143620000") body = scenario.oddsAfter;
    else if (path === "/api/scores/stat-validation?fixtureId=18241006&seq=2&statKeys=1,2") body = scenario.validationFirst;
    else if (path === "/api/scores/stat-validation?fixtureId=18241006&seq=4&statKeys=1,2") body = scenario.validation;
    else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "test route not found" }));
      return;
    }
    response.statusCode = 200;
    if (options.scoresAsSse && path === "/api/scores/historical/18241006") {
      response.setHeader("Content-Type", "text/event-stream");
      response.end((body as unknown[]).map((record) => `data: ${JSON.stringify(record)}\n\n`).join(""));
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
