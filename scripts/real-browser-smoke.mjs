import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const port = 4320; // Fixed local-only port for the reproducible production smoke.
const origin = `http://127.0.0.1:${port}`;
const manifest = JSON.parse(await readFile(new URL("../config/replay-manifest.json", import.meta.url), "utf8"));
const expected = manifest.expectedRealSmoke;
const judgeAccessToken = process.env.JUDGE_ACCESS_TOKEN?.trim();
if (!judgeAccessToken || judgeAccessToken.length < 16) {
  throw new Error("JUDGE_ACCESS_TOKEN (minimum 16 characters) is required for the production browser smoke");
}
if (!process.env.REAL_DATA_DISABLE_AT?.trim()) {
  throw new Error("REAL_DATA_DISABLE_AT is required for the production browser smoke");
}
const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Production server exited before browser smoke");
    try {
      const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Retry during local startup only.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Production server did not become healthy");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addInitScript((token) => {
    window.sessionStorage.setItem("torcida-pulse:judge-access", token);
  }, judgeAccessToken);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const responsePromise = page.waitForResponse((response) => response.url() === `${origin}/api/replays/${manifest.fixtureId}`);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const replayResponse = await responsePromise;
  if (replayResponse.status() !== 200) throw new Error(`Real replay returned HTTP ${replayResponse.status()}`);
  const normalizedBody = await replayResponse.body();
  const normalizedEnvelopeSha256 = createHash("sha256").update(normalizedBody).digest("hex");
  const normalizedReplay = JSON.parse(normalizedBody.toString("utf8"));
  const turningEvent = normalizedReplay.events.find(({ seq }) => seq === normalizedReplay.turningPoint?.eventSeq);
  if (
    normalizedReplay.turningPoint?.eventSeq !== expected.turningPointSeq ||
    normalizedReplay.turningPoint?.minute !== expected.turningPointMinute ||
    turningEvent?.score?.participant1 !== expected.participant1Score ||
    turningEvent?.score?.participant2 !== expected.participant2Score
  ) {
    throw new Error("Normalized replay did not match the active manifest turning point");
  }

  await page.locator('[data-testid="source-banner"]').waitFor({ state: "visible" });
  if (!(await page.locator('[data-testid="source-banner"]').innerText()).toLowerCase().includes("txline devnet")) {
    throw new Error("Real-source banner is absent");
  }
  if ((await page.locator('[data-testid="match-card"]').count()) !== 1) throw new Error("Real match picker is absent");
  if ((await page.locator('[data-testid="turning-point"]').count()) !== 0) throw new Error("Turning point leaked in picker");
  if ((await page.locator('[data-proof-state]').count()) !== 0) throw new Error("Proof state leaked in picker");

  await page.locator("#open-replay").click();
  const initialScoreText = await page.locator('[data-testid="score-card"]').innerText();
  if (initialScoreText.includes(`${expected.participant1Score} — ${expected.participant2Score}`)) {
    throw new Error("Final score leaked at playhead zero");
  }
  if ((await page.locator('[data-testid="turning-point"]').count()) !== 0) throw new Error("Turning point leaked at playhead zero");
  if ((await page.locator('[data-testid="provenance"]').count()) !== 0) throw new Error("Provenance leaked at playhead zero");

  await page.locator("#scrub").evaluate((element, value) => {
    const input = element;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, Math.max(0, normalizedReplay.turningPoint.playbackMs - 500));
  const scrollBeforeTurningPoint = await page.evaluate(() => window.scrollY);
  await page.locator("#play").click();
  await page.locator('[data-testid="turning-point"]').waitFor({ state: "visible", timeout: 25_000 });
  const playheadMs = Number(await page.locator("#scrub").inputValue());
  if (Math.abs(playheadMs - normalizedReplay.turningPoint.playbackMs) > 250) {
    throw new Error("Auto-pause did not stop at the manifest turning point");
  }
  if ((await page.locator("#play").getAttribute("aria-pressed")) !== "false") throw new Error("Playback did not auto-pause");
  const turningPointText = await page.locator('[data-testid="turning-point"]').innerText();
  const normalizedTurningPointText = turningPointText.toLocaleLowerCase("pt-BR");
  const comebackFrameChecks = {
    minute: turningPointText.includes(`${expected.turningPointMinute}′`),
    score: turningPointText.includes(`${expected.participant1Score} — ${expected.participant2Score}`),
    scoreLabel: normalizedTurningPointText.includes(`placar aos ${expected.turningPointMinute}′`),
    before: turningPointText.includes(`${expected.beforePct.toFixed(1)}%`),
    after: turningPointText.includes(`${expected.afterPct.toFixed(1)}%`),
  };
  if (!Object.values(comebackFrameChecks).every(Boolean)) {
    throw new Error("Authored frame does not show the truthful 91′ / 1–2 comeback and its two TxLINE points");
  }
  const pulseMovementText = await page.locator('[data-testid="pulse-movement"]').innerText();
  const expectedDelta = Math.abs(expected.afterPct - expected.beforePct).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (
    !pulseMovementText.includes(`${expected.beforePct.toFixed(1)}%`) ||
    !pulseMovementText.includes(`${expected.afterPct.toFixed(1)}%`) ||
    !pulseMovementText.includes(`+${expectedDelta} pp`)
  ) {
    throw new Error("Pulse does not show the real before, after, and percentage-point movement");
  }
  if ((await page.locator('[data-proof-state="verified"]').count()) !== 1) throw new Error("Verified proof badge is absent");
  const endpointCount = await page.locator('[data-testid="endpoints"] li').count();
  if (endpointCount !== 5) throw new Error("Five endpoint evidence rows are not visible");
  await page.waitForTimeout(750); // Let the authored 650ms Virada entrance settle.
  await page.mouse.move(374, 811);
  const liveFlow = await page.evaluate(() => {
    const pulse = document.querySelector('[data-testid="live-pulse"]')?.getBoundingClientRect();
    const turningPoint = document.querySelector('[data-testid="turning-point"]')?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      pulseBottom: pulse?.bottom ?? 0,
      turningPointTop: turningPoint?.top ?? 0,
    };
  });
  if (liveFlow.scrollY !== scrollBeforeTurningPoint) {
    throw new Error("Auto-pause changed the page position instead of updating the live card in place");
  }
  if (liveFlow.turningPointTop < liveFlow.pulseBottom) {
    throw new Error("Turning Point is not below the Pulse card in the live page flow");
  }
  await page.screenshot({ path: "artifacts/momento-da-virada-375.png" });

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (dimensions.scrollWidth > dimensions.innerWidth) throw new Error("Real replay overflows horizontally at 375px");
  const buttons = await page.locator("button:visible").all();
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box || box.height < 44) throw new Error("A visible button is shorter than 44px");
  }

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousViolations = accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  if (seriousViolations.length > 0) throw new Error("Real replay has serious/critical accessibility violations");

  await page.locator("#continue-replay").click();
  await page.locator("#reveal-all").click();
  await page.locator('[data-testid="score-card"]').waitFor({ state: "visible" });
  const finalScoreText = (await page.locator('[data-testid="score-card"]').innerText()).replace(/\s+/g, " ");
  if (!finalScoreText.includes(`${expected.participant1Score} — ${expected.participant2Score}`)) {
    throw new Error("Full replay did not preserve the manifest score");
  }
  await page.screenshot({ path: "artifacts/real-browser-375.png", fullPage: true });
  if (consoleErrors.length > 0) throw new Error("Browser console reported an error");

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "REAL_BROWSER_GREEN",
        viewport: "375x812",
        sourceMode: "real_txline",
        normalizedEnvelopeSha256,
        autoPaused: true,
        playheadMs,
        fixtureId: manifest.fixtureId,
        turningPointSeq: expected.turningPointSeq,
        turningPointMinute: expected.turningPointMinute,
        turningPointScore: `${expected.participant1Score}-${expected.participant2Score}`,
        turningPointVisible: true,
        pulseMovementVisible: true,
        turningPointTop: Math.round(liveFlow.turningPointTop),
        proofState: "verified",
        endpointCount,
        horizontalOverflow: false,
        seriousOrCriticalAxeViolations: 0,
        consoleErrors: 0,
        coverScreenshot: "artifacts/momento-da-virada-375.png",
        evidenceScreenshot: "artifacts/real-browser-375.png",
        rawPayloadPrinted: false,
      },
      null,
      2,
    )}\n`,
  );
  await context.close();
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill("SIGTERM");
}
