import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const scenario = JSON.parse(readFileSync(new URL("../fixtures/txline-contract-scenario.json", import.meta.url), "utf8"));
const port = Number(process.env.MOCK_TODDS_PORT || 4311);

const server = createServer((request, response) => {
  if (request.headers.authorization !== "Bearer e2e-jwt" || request.headers["x-api-token"] !== "txoracle_api_e2e_only") {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "e2e auth rejected" }));
    return;
  }
  const path = request.url;
  let body;
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
    response.end(JSON.stringify({ error: "e2e route not found" }));
    return;
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`Fictional TxLINE contract server on ${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
