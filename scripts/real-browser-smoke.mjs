import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const port = 4320; // Fixed local-only port for the reproducible production smoke.
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Production server exited before browser smoke");
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Retry during local startup only.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Production server did not become healthy");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const responsePromise = page.waitForResponse((response) => response.url() === `${origin}/api/replays/18241006`);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const replayResponse = await responsePromise;
  if (replayResponse.status() !== 200) throw new Error(`Real replay returned HTTP ${replayResponse.status()}`);
  const normalizedBody = await replayResponse.body();
  const normalizedEnvelopeSha256 = createHash("sha256").update(normalizedBody).digest("hex");
  const normalizedReplay = JSON.parse(normalizedBody.toString("utf8"));
  const turningEvent = normalizedReplay.events.find(({ seq }) => seq === normalizedReplay.turningPoint?.eventSeq);
  if (
    normalizedReplay.turningPoint?.eventSeq !== 871 ||
    normalizedReplay.turningPoint?.minute !== 91 ||
    turningEvent?.score?.participant1 !== 1 ||
    turningEvent?.score?.participant2 !== 2
  ) {
    throw new Error("Normalized replay did not select the 91′ / 1–2 lead reversal");
  }

  await page.locator('[data-testid="source-banner"]').waitFor({ state: "visible" });
  if (!(await page.locator('[data-testid="source-banner"]').innerText()).toLowerCase().includes("txline devnet")) {
    throw new Error("Real-source banner is absent");
  }
  if ((await page.locator('[data-testid="match-card"]').count()) !== 1) throw new Error("Real match picker is absent");
  if ((await page.locator('[data-testid="turning-point"]').count()) !== 0) throw new Error("Turning point leaked in picker");
  if ((await page.locator('[data-proof-state]').count()) !== 0) throw new Error("Proof state leaked in picker");

  await page.locator("#open-replay").click();
  if ((await page.locator('[data-testid="score-card"]').count()) !== 0) throw new Error("Score leaked at playhead zero");
  if ((await page.locator('[data-testid="turning-point"]').count()) !== 0) throw new Error("Turning point leaked at playhead zero");
  if ((await page.locator('[data-testid="provenance"]').count()) !== 0) throw new Error("Provenance leaked at playhead zero");

  await page.locator("#play").click();
  await page.locator('[data-testid="turning-point"]').waitFor({ state: "visible", timeout: 25_000 });
  const playheadMs = Number(await page.locator("#scrub").inputValue());
  if (!(playheadMs > 16_000 && playheadMs < 18_000)) throw new Error("Auto-pause did not stop at the 91′ lead reversal");
  if ((await page.locator("#play").getAttribute("aria-pressed")) !== "false") throw new Error("Playback did not auto-pause");
  const turningPointText = await page.locator('[data-testid="turning-point"]').innerText();
  const normalizedTurningPointText = turningPointText.toLocaleLowerCase("pt-BR");
  const comebackFrameChecks = {
    minute: turningPointText.includes("91′"),
    score: turningPointText.includes("1 — 2"),
    scoreLabel: normalizedTurningPointText.includes("placar aos 91′"),
    before: turningPointText.includes("13.0%"),
    after: turningPointText.includes("88.7%"),
  };
  if (!Object.values(comebackFrameChecks).every(Boolean)) {
    throw new Error("Authored frame does not show the truthful 91′ / 1–2 comeback and its two TxLINE points");
  }
  if ((await page.locator('[data-proof-state="verified"]').count()) !== 1) throw new Error("Verified proof badge is absent");
  const endpointCount = await page.locator('[data-testid="endpoints"] li').count();
  if (endpointCount !== 5) throw new Error("Five endpoint evidence rows are not visible");
  await page.waitForTimeout(750); // Let the authored 650ms Virada entrance and viewport snap settle.
  await page.mouse.move(374, 811);
  const turningPointTop = await page.locator('[data-testid="turning-point"]').evaluate((element) =>
    element.getBoundingClientRect().top,
  );
  if (turningPointTop < -20 || turningPointTop > 20) throw new Error("Turning Point did not own the mobile viewport after auto-pause");
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

  await page.locator("#reveal-all").click();
  await page.locator('[data-testid="score-card"]').waitFor({ state: "visible" });
  const finalScoreText = (await page.locator('[data-testid="score-card"]').innerText()).replace(/\s+/g, " ");
  if (!finalScoreText.includes("1 — 2")) {
    throw new Error("Full replay did not preserve the final 1–2 score");
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
        turningPointSeq: 871,
        turningPointMinute: 91,
        turningPointScore: "1-2",
        turningPointVisible: true,
        turningPointTop: Math.round(turningPointTop),
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
