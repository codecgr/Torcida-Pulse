import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("authenticated TxLINE input drives the 375px spoiler-safe Turning Point flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");

  await expect(page.getByTestId("source-banner")).toContainText("TxLINE devnet");
  await expect(page.getByTestId("match-card")).toContainText("Azul Teste");
  const pickerText = await page.locator("body").innerText();
  expect(pickerText).not.toContain("12.9%");
  expect(pickerText).not.toContain("88.7%");
  expect(pickerText).not.toContain("scores/stat-validation");
  expect(pickerText).not.toContain("Verificado na Solana");

  await page.getByRole("button", { name: "Entrar sem spoiler" }).click();
  await expect(page.getByTestId("timeline")).toContainText("Início");
  const safeText = await page.locator("body").innerText();
  expect(safeText).not.toContain("Gol");
  expect(safeText).not.toContain("12.9%");
  expect(safeText).not.toContain("1 — 2");
  expect(await page.getByTestId("score-card").count()).toBe(0);
  expect(await page.getByTestId("provenance").count()).toBe(0);

  await page.getByRole("button", { name: "Reproduzir" }).click();
  await expect(page.getByTestId("turning-point")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("turning-point")).toContainText("Pausa automática");
  await expect(page.getByTestId("turning-point")).toContainText("91′");
  await expect(page.getByTestId("turning-point")).toContainText("12.9%");
  await expect(page.getByTestId("turning-point")).toContainText("88.7%");
  await expect(page.getByTestId("turning-point")).toContainText("1 — 2");
  await expect(page.getByTestId("turning-point")).toContainText("Placar aos 91′");
  await expect(page.getByTestId("turning-point")).toContainText("coincidiu");
  await expect(page.locator('[data-proof-state="verified"]')).toContainText("Verificado na Solana");
  await expect(page.getByTestId("endpoints").locator("li")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
  const momentTop = await page.getByTestId("turning-point").evaluate((element) => element.getBoundingClientRect().top);
  expect(momentTop).toBeGreaterThanOrEqual(-20);
  expect(momentTop).toBeLessThanOrEqual(20);
  await page.screenshot({ path: "test-results/e2e-turning-point-375.png", fullPage: true });

  const dimensions = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.inner);
  for (const button of await page.locator("button:visible").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.getByRole("button", { name: "Revelar replay completo" }).click();
  await expect(page.getByTestId("score-card")).toContainText("1 — 2");
  await expect(page.getByTestId("timeline")).toContainText("Fim de jogo");
  const revealedMoment = await page.getByTestId("turning-point").evaluate((element) => ({
    clipPath: getComputedStyle(element).clipPath,
    width: element.getBoundingClientRect().width,
  }));
  expect(revealedMoment.clipPath).toBe("none");
  expect(revealedMoment.width).toBeGreaterThan(320);

  await page.getByRole("button", { name: "Change language" }).click();
  await expect(page.getByTestId("turning-point")).toContainText("Turning Point");
  const englishReplayWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(englishReplayWidth.scroll).toBeLessThanOrEqual(englishReplayWidth.inner);
  expect(consoleErrors).toEqual([]);
});

test("the visible playhead score advances through the full comeback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar sem spoiler" }).click();
  const scrub = page.locator("#scrub");
  const scrubTo = async (playheadMs: number) => {
    await scrub.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, playheadMs);
  };

  await scrubTo(2_500);
  await expect(page.getByTestId("score-card")).toContainText("1 — 0");
  await scrubTo(3_300);
  await expect(page.getByTestId("score-card")).toContainText("1 — 1");
  await scrubTo(4_100);
  await expect(page.getByTestId("score-card")).toContainText("1 — 2");
  await expect(page.getByTestId("turning-point")).toContainText("Placar aos 91′");

  const scoreBox = await page.getByTestId("score-card").boundingBox();
  expect(scoreBox).not.toBeNull();
  expect((scoreBox?.y ?? 812) + (scoreBox?.height ?? 0)).toBeGreaterThan(0);
  expect(scoreBox?.y ?? 812).toBeLessThan(812);
});

test("editorial picker holds at desktop, 320px, and in English", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("match-card")).toBeVisible();

  const desktop = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>(".picker-hero h1");
    return {
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      headingSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
    };
  });
  expect(desktop.scroll).toBeLessThanOrEqual(desktop.inner);
  expect(desktop.headingSize).toBeGreaterThan(80);

  await page.setViewportSize({ width: 320, height: 800 });
  const mobile = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>(".picker-hero h1");
    const cta = document.querySelector<HTMLElement>("#open-replay");
    return {
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      headingSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
      ctaClientWidth: cta?.clientWidth ?? 0,
      ctaScrollWidth: cta?.scrollWidth ?? 1,
    };
  });
  expect(mobile.scroll).toBeLessThanOrEqual(mobile.inner);
  expect(mobile.headingSize).toBeGreaterThan(48);
  expect(mobile.ctaScrollWidth).toBeLessThanOrEqual(mobile.ctaClientWidth);

  await page.getByRole("button", { name: "Change language" }).click();
  await expect(page.getByRole("heading", { name: "You missed the match. Don't miss the turning point." })).toBeVisible();
  const englishWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(englishWidth.scroll).toBeLessThanOrEqual(englishWidth.inner);

  await page.waitForTimeout(750); // Evaluate the settled design, not the 700ms entrance blend.
  const pickerAccessibility = await new AxeBuilder({ page }).analyze();
  expect(pickerAccessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
