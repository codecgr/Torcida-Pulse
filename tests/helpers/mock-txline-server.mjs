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
  else if (path === "/api/fixtures/snapshot?startEpochDay=20615") body = [{
    FixtureId: 18257739,
    Participant1: "Spain",
    Participant2: "Argentina",
    Participant1Id: 1001,
    Participant2Id: 1002,
    Participant1IsHome: true,
    StartTime: 1784487600000,
    Competition: "World Cup",
    GameState: 1,
  }];
  else if (path === "/api/scores/historical/18241006") body = scenario.scores;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784142780000") body = scenario.oddsFirstBefore;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784143020000") body = scenario.oddsFirstAfter;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784143080000") body = scenario.oddsSecondBefore;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784143320000") body = scenario.oddsSecondAfter;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784143380000") body = scenario.oddsBefore;
  else if (path === "/api/odds/snapshot/18241006?asOf=1784143620000") body = scenario.oddsAfter;
  else if (path?.startsWith("/api/odds/snapshot/18241006?asOf=")) {
    const asOf = Number(new URL(path, "http://txline.test").searchParams.get("asOf"));
    const participant1Pct = 40 + (Math.floor(asOf / 60_000) % 20);
    body = [{
      FixtureId: 18241006,
      MessageId: `fictional-generic-${asOf}`,
      Ts: asOf,
      Bookmaker: "FictionalConsensus",
      BookmakerId: 77,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketPeriod: null,
      MarketParameters: null,
      PriceNames: ["Azul Teste", "draw", "Dourado Teste"],
      Prices: [100, 300, 100],
      Pct: [String(participant1Pct), "20", String(80 - participant1Pct)],
    }];
  }
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
