import { chromium } from "@playwright/test";

const rawBaseUrl = process.env.BASE_URL?.trim();
if (!rawBaseUrl) throw new Error("BASE_URL is required (for example, https://torcida.example).");
const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:") throw new Error("BASE_URL must use HTTPS.");
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS certificate verification must remain enabled.");
if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
  throw new Error("BASE_URL must not contain credentials, query parameters, or a fragment.");
}
baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") || "/";
const judgeAccessToken = process.env.JUDGE_ACCESS_TOKEN?.trim();
if (!judgeAccessToken || judgeAccessToken.length < 16) {
  throw new Error("JUDGE_ACCESS_TOKEN (minimum 16 characters) is required for the deployed real-route smoke.");
}

const MAX_SMOKE_BODY_BYTES = 2 * 1024 * 1024;
const expectedEndpointIds = [
  "fixtures_snapshot",
  "scores_historical",
  "odds_before",
  "odds_after",
  "scores_stat_validation",
];

function assert(condition, message) {
  if (!condition) throw new Error(`DEPLOYED SMOKE: ${message}`);
}

function deployedUrl(path) {
  return new URL(path.replace(/^\/+/, ""), baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`);
}

async function limitedText(response) {
  const declared = Number(response.headers.get("content-length"));
  assert(!Number.isFinite(declared) || declared <= MAX_SMOKE_BODY_BYTES, "response body is unexpectedly large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_SMOKE_BODY_BYTES) {
        await reader.cancel();
        throw new Error("DEPLOYED SMOKE: response body exceeded the smoke limit");
      }
      if (value) chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function get(path, accept, judgeAccess = false) {
  const headers = { Accept: accept };
  if (judgeAccess) headers["X-Judge-Access"] = judgeAccessToken;
  const response = await fetch(deployedUrl(path), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert(new URL(response.url).origin === baseUrl.origin, `${path} escaped the deployment origin`);
  return { response, text: await limitedText(response) };
}

function assertNoSecrets(label, text) {
  const forbiddenPatterns = [
    /txoracle_api_[A-Za-z0-9_-]+/i,
    /authorization\s*:/i,
    /guestJwt/i,
    /subTreeProof/i,
    /mainTreeProof/i,
    /eventStatRoot/i,
    /BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY/i,
    /seed phrase/i,
  ];
  for (const pattern of forbiddenPatterns) assert(!pattern.test(text), `${label} exposes a forbidden secret/proof marker`);
  for (const secretName of ["TXLINE_GUEST_JWT", "TXLINE_API_TOKEN"]) {
    const secret = process.env[secretName];
    if (secret && secret.length >= 8) assert(!text.includes(secret), `${label} exposes ${secretName}`);
  }
  assert(!text.includes(judgeAccessToken), `${label} exposes JUDGE_ACCESS_TOKEN`);
}

const root = await get("/", "text/html");
assert(root.response.status === 200, "root is not ready");
assert(root.response.headers.get("content-type")?.includes("text/html"), "root content type is not HTML");
assert(root.response.headers.get("content-security-policy")?.includes("default-src 'self'"), "root CSP is missing");
assert(root.response.headers.get("x-robots-tag") === "noindex, nofollow, noarchive", "root noindex header is missing");
assert(root.text.includes("Torcida Pulse"), "root does not contain the product shell");
assert(root.text.includes('name="robots" content="noindex, nofollow, noarchive"'), "root robots meta is missing");
assertNoSecrets("root HTML", root.text);

const assetPaths = [...root.text.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map((match) => match[1]);
for (const assetPath of assetPaths) {
  const asset = await get(assetPath, "*/*");
  assert(asset.response.status === 200, `asset ${assetPath} is unavailable`);
  assertNoSecrets(`asset ${assetPath}`, asset.text);
}

const liveResult = await get("/api/live", "application/json");
assert(liveResult.response.status === 200 && JSON.parse(liveResult.text).status === "live", "liveness route is invalid");

let readyResult;
for (let attempt = 0; attempt < 30; attempt += 1) {
  readyResult = await get("/api/ready", "application/json");
  if (readyResult.response.status === 200) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert(readyResult?.response.status === 200 && JSON.parse(readyResult.text).status === "ready", "real replay did not become ready");

const healthResult = await get("/api/health", "application/json");
assert(healthResult.response.status === 200, "health route is not ready");
assert(/^[0-9a-f-]{36}$/.test(healthResult.response.headers.get("x-request-id") ?? ""), "health request ID is missing");
assert(healthResult.response.headers.get("content-security-policy")?.includes("default-src 'self'"), "API CSP is missing");
const health = JSON.parse(healthResult.text);
assert(health.status === "ok", "health schema status is invalid");
assert(health.source === "TxLINE devnet", "health source is invalid");
assert(health.credentialsConfigured === true, "host secrets are not configured");
assert(health.rawPayloadsStored === false, "health route does not prohibit raw payload storage");
assertNoSecrets("health response", healthResult.text);

const replayResult = await get("/api/replays/18241006", "application/json", true);
assert(replayResult.response.status === 200, "real replay route is unavailable");
assert(/^[0-9a-f-]{36}$/.test(replayResult.response.headers.get("x-request-id") ?? ""), "replay request ID is missing");
const replay = JSON.parse(replayResult.text);
assert(replay.schemaVersion === "1.0", "replay schemaVersion is invalid");
assert(replay.source?.mode === "real_txline" && replay.source?.network === "devnet", "replay source is not real TxLINE devnet");
assert(replay.match?.fixtureId === "18241006", "replay fixture is not frozen");
assert(Array.isArray(replay.events) && replay.events.length > 0, "replay events are empty");
assert(replay.playbackDurationMs === 20_000, "replay duration contract drifted");
assert(replay.provenance?.state === "verified", "deployed proof is not verified");
assert(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(replay.provenance.dailyScoresPda ?? ""), "daily scores PDA is invalid");
assert(Number.isFinite(replay.provenance.proofTargetTs), "proof target timestamp is missing");
assert(Number.isFinite(Date.parse(replay.provenance.checkedAt)), "proof checkedAt is missing");
assert(JSON.stringify(replay.source.endpoints?.map(({ id }) => id)) === JSON.stringify(expectedEndpointIds), "endpoint evidence schema/order drifted");
assertNoSecrets("replay response", replayResult.text);

const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    timezoneId: "America/Sao_Paulo",
  });
  await context.addInitScript((token) => {
    window.sessionStorage.setItem("torcida-pulse:judge-access", token);
  }, judgeAccessToken);
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
  const navigation = await page.goto(baseUrl.href, { waitUntil: "networkidle", timeout: 30_000 });
  assert(navigation?.status() === 200, "Chromium navigation failed");
  await page.locator('[data-testid="match-card"]').waitFor();
  const initialText = await page.locator("body").innerText();
  assert(!initialText.includes("1 — 2"), "initial DOM leaks the final score");
  assert(!initialText.includes("scores/stat-validation"), "initial DOM leaks proof endpoint detail");
  await page.locator("#open-replay").click();
  await page.locator("#reveal-all").click();
  await page.locator('[data-proof-state="verified"]').waitFor();
  const explorerHref = await page.locator('[data-testid="proof-explorer"]').getAttribute("href");
  assert(
    explorerHref === `https://explorer.solana.com/address/${replay.provenance.dailyScoresPda}?cluster=devnet`,
    "Explorer devnet link does not match the verified PDA"
  );
  const dimensions = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(dimensions.scrollWidth <= dimensions.innerWidth, "375 px page has horizontal overflow");
  assertNoSecrets("rendered browser DOM", await page.content());
  assert(consoleErrors.length === 0, `browser console has errors (${consoleErrors.length})`);
  assert(pageErrors.length === 0, `browser has page errors (${pageErrors.length})`);
  assert(requestFailures.length === 0, `browser has failed requests (${requestFailures.length})`);
  await context.close();
} finally {
  await browser.close();
}

process.stdout.write("DEPLOYED SMOKE OK: TLS, readiness, CSP, normalized replay schema, verified proof, 375 px Chromium, console, and secret scan.\n");
