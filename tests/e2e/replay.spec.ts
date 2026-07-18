import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COPY, type Lang } from "../../src/i18n";

const MATRIX_VIEWPORTS = [
  { name: "320", width: 320, height: 800 },
  { name: "375", width: 375, height: 812 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const MATRIX_LANGUAGES: Lang[] = ["pt-BR", "en"];
const MATRIX_STATES = ["picker", "initial", "auto-pause", "final", "error"] as const;

async function chooseLanguage(page: Page, lang: Lang): Promise<void> {
  if (lang === "en") await page.getByRole("button", { name: COPY["pt-BR"].changeLanguage }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page).toHaveTitle(COPY[lang].documentTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", COPY[lang].metaDescription);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", COPY[lang].socialLocale);
}

async function setScrubber(page: Page, playheadMs: number): Promise<void> {
  await page.locator("#scrub").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, playheadMs);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.inner);
}

async function expectCompleteAxePass(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

async function expectNoOppositeLanguageLiterals(page: Page, lang: Lang): Promise<void> {
  const surface = await page.evaluate(() => {
    const attributes = [...document.querySelectorAll<HTMLElement>("[aria-label], [title]")]
      .flatMap((element) => [element.getAttribute("aria-label"), element.getAttribute("title")])
      .filter(Boolean);
    const metadata = [...document.querySelectorAll<HTMLMetaElement>("meta[content]")]
      .map((element) => element.content);
    return [document.body.innerText, document.title, ...attributes, ...metadata].join("\n");
  });
  const opposite = lang === "pt-BR" ? COPY.en : COPY["pt-BR"];
  const forbidden = [
    opposite.changeLanguage,
    opposite.txlineOffline,
    opposite.serverSideNoStore,
    opposite.signalPlay,
    opposite.signalProof,
    opposite.replayControls,
    opposite.replayPosition,
    opposite.eventFeed,
    opposite.liveAtPlayhead,
    opposite.trustLayer,
    opposite.normalizedNoStore,
    opposite.readOnlySimulation,
  ];
  const lines = surface.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const literal of forbidden) {
    if (/^[\p{Lu}\d]+$/u.test(literal)) expect(lines).not.toContain(literal);
    else expect(surface).not.toContain(literal);
  }
}

test("authenticated TxLINE input drives the 375px spoiler-safe Turning Point flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");

  await expect(page.getByTestId("source-banner")).toContainText("TxLINE devnet");
  await expect(page.getByTestId("match-card")).toContainText("Azul Teste");
  const firstFold = await page.evaluate(() => ({
    promiseVisible: Boolean(document.querySelector(".picker-hero h1")),
    matchVisible: Boolean(document.querySelector('[data-testid="match-card"]')),
    ctaBottom: document.querySelector<HTMLElement>("#open-replay")?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
  }));
  expect(firstFold.promiseVisible).toBe(true);
  expect(firstFold.matchVisible).toBe(true);
  expect(firstFold.ctaBottom).toBeLessThanOrEqual(812);
  const pickerText = await page.locator("body").innerText();
  expect(pickerText).not.toContain("12.9%");
  expect(pickerText).not.toContain("88.7%");
  expect(pickerText).not.toContain("scores/stat-validation");
  expect(pickerText).not.toContain("Verificado na Solana");

  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await expect(page.getByTestId("timeline")).toContainText("Início");
  const safeText = await page.locator("body").innerText();
  expect(safeText).not.toContain("Gol");
  expect(safeText).not.toContain("12.9%");
  expect(safeText).not.toContain("1 — 2");
  await expect(page.getByTestId("score-card")).toContainText(COPY["pt-BR"].hiddenScore);
  expect(await page.getByTestId("provenance").count()).toBe(0);

  await expect(page.getByTestId("turning-point")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("turning-point")).toContainText("Replay pausado automaticamente");
  await expect(page.getByTestId("turning-point")).toContainText("A virada aconteceu");
  await expect(page.getByTestId("turning-point")).toContainText("91′");
  await expect(page.getByTestId("turning-point")).toContainText("12.9%");
  await expect(page.getByTestId("turning-point")).toContainText("88.7%");
  await expect(page.getByTestId("turning-point")).toContainText("1 — 2");
  await expect(page.getByTestId("turning-point")).toContainText("Placar aos 91′");
  await expect(page.getByTestId("turning-point")).toContainText("sinal TxLINE");
  await expect(page.locator('[data-proof-state="verified"]')).toContainText("Verificado na Solana");
  await expect(page.getByTestId("provenance")).toContainText("HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX");
  await expect(page.getByTestId("provenance")).toContainText("2026-07-15 16:25:00 GMT-3");
  await expect(page.getByTestId("provenance")).toContainText("2026-07-17 09:00:00 GMT-3");
  await expect(page.getByTestId("provenance")).toContainText("Simulação somente leitura");
  await expect(page.getByTestId("proof-explorer")).toHaveAttribute(
    "href",
    "https://explorer.solana.com/address/HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX?cluster=devnet"
  );
  await expect(page.getByTestId("proof-explorer")).not.toBeVisible();
  await expect(page.getByTestId("endpoints").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("turning-point").getByRole("button", { name: "Continuar replay", exact: true })).toBeVisible();
  const momentTop = await page.getByTestId("turning-point").evaluate((element) => element.getBoundingClientRect().top);
  expect(momentTop).toBeGreaterThanOrEqual(50);
  expect(momentTop).toBeLessThanOrEqual(220);
  const mobileStage = await page.evaluate(() => {
    const controls = document.querySelector<HTMLElement>(".replay-controls");
    const point = document.querySelector<HTMLElement>('[data-testid="turning-point"]');
    return {
      controlsDisplay: controls ? getComputedStyle(controls).display : "",
      controlsBottom: controls?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      visibleMomentHeight: point ? Math.min(point.getBoundingClientRect().bottom, window.innerHeight) - Math.max(point.getBoundingClientRect().top, 0) : 0,
    };
  });
  expect(mobileStage.controlsDisplay).toBe("none");
  expect(mobileStage.visibleMomentHeight).toBeGreaterThan(450);
  await page.screenshot({ path: "test-results/e2e-turning-point-375.png", fullPage: true });

  const dimensions = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.inner);
  for (const button of await page.locator("button:visible").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.getByTestId("proof-compact").click();
  await expect(page.getByTestId("proof-explorer")).toBeVisible();
  await expect(page.getByTestId("provenance").locator(".proof-details > summary")).toBeFocused();

  await page.getByRole("button", { name: COPY["pt-BR"].tabLive, exact: true }).click();
  await page.getByTestId("turning-point").getByRole("button", { name: COPY["pt-BR"].continueReplay }).click();
  await page.getByRole("button", { name: "Revelar replay completo" }).click();
  await expect(page.getByTestId("score-card")).toContainText("1 — 2");
  await expect(page.getByTestId("timeline")).toContainText("Fim de jogo");
  const ending = page.getByTestId("replay-ending");
  await expect(ending).toBeVisible();
  await expect(page.locator(".replay-head")).toContainText(COPY["pt-BR"].replayComplete);
  await expect(page.locator(".replay-title")).toContainText(COPY["pt-BR"].spoilersRevealed);
  await expect(ending.getByRole("button", { name: "Compartilhar momento" })).toBeVisible();
  await expect(ending.getByRole("button", { name: "Reviver esta partida" })).toBeVisible();
  await expect(ending.getByRole("button", { name: COPY["pt-BR"].nextMoment })).toHaveCount(0);
  await expect(ending).toContainText("Conceito visual · sem mint");
  await expect(page.getByTestId("turning-point")).toBeHidden();

  await page.getByRole("button", { name: "Mudar idioma" }).click();
  await expect(page.getByTestId("turning-point")).toContainText("Turning Point");
  const englishReplayWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(englishReplayWidth.scroll).toBeLessThanOrEqual(englishReplayWidth.inner);
  expect(consoleErrors).toEqual([]);
});

test("mobile app shell keeps one fan task per surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const shell = page.getByTestId("app-shell");
  await expect(shell).toBeVisible();
  const pickerBox = await shell.boundingBox();
  expect(pickerBox?.width).toBeLessThanOrEqual(430);
  await expect(page.getByRole("button", { name: COPY["pt-BR"].openReplay })).toBeInViewport();
  await page.screenshot({ path: "test-results/app-picker-390.png" });

  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  const navigation = page.getByRole("navigation", { name: "Navegação do replay" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button", { name: COPY["pt-BR"].tabLive })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("surface-live")).toBeVisible();
  await expect(page.getByTestId("surface-moments")).toBeHidden();
  await expect(page.getByTestId("surface-proof")).toBeHidden();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/app-live-390.png" });

  await navigation.getByRole("button", { name: "Momentos" }).click();
  await expect(page.getByTestId("surface-live")).toBeHidden();
  await expect(page.getByTestId("surface-moments")).toBeVisible();
  await expect(page.getByTestId("timeline")).toContainText("Início");

  await navigation.getByRole("button", { name: COPY["pt-BR"].tabLive }).click();
  await setScrubber(page, 3_800);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByTestId("turning-point")).toBeVisible({ timeout: 2_000 });
  await expect(navigation.getByRole("button", { name: COPY["pt-BR"].tabLive })).toHaveAttribute("aria-current", "page");
  await page.waitForTimeout(450);
  await page.screenshot({ path: "test-results/app-turning-390.png" });

  await page.getByTestId("proof-compact").click();
  await expect(navigation.getByRole("button", { name: "Prova" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("surface-proof")).toBeVisible();
  await expect(page.getByTestId("provenance")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/app-proof-390.png" });

  const chrome = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".app-tabs");
    const controls = document.querySelector<HTMLElement>(".replay-controls");
    return {
      navPosition: nav ? getComputedStyle(nav).position : "",
      navBottom: nav?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      controlsBottom: controls?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      viewport: window.innerHeight,
    };
  });
  expect(chrome.navPosition).toBe("fixed");
  expect(chrome.navBottom).toBeLessThanOrEqual(chrome.viewport);
  expect(chrome.controlsBottom).toBeLessThanOrEqual(chrome.viewport - 60);
  await expectNoHorizontalOverflow(page);
});

test("mainstream fan journey starts in one tap and removes dead-end decoration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __sharedMoment?: ShareData }).__sharedMoment = data;
      },
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("turning-point")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByTestId("turning-point").getByRole("button", { name: COPY["pt-BR"].continueReplay })).toBeFocused();
  await expect(page.locator(".replay-controls")).toBeHidden();

  await page.getByTestId("turning-point").getByRole("button", { name: COPY["pt-BR"].shareMoment }).click();
  await expect(page.locator("#toast")).toContainText(COPY["pt-BR"].shared);
  const sharedText = await page.evaluate(() => (window as Window & { __sharedMoment?: ShareData }).__sharedMoment?.text);
  expect(sharedText).toContain("Dourado Teste");
  expect(sharedText).not.toContain(COPY["pt-BR"].autoPaused);

  await page.getByTestId("turning-point").getByRole("button", { name: COPY["pt-BR"].continueReplay }).click();
  await page.getByRole("button", { name: COPY["pt-BR"].revealAll }).click();
  const ending = page.getByTestId("replay-ending");
  await expect(ending).toBeVisible();
  await expect(ending.getByRole("button", { name: COPY["pt-BR"].nextMoment })).toHaveCount(0);
  await expect(page.locator(".replay-controls")).toHaveCSS("position", "static");
  await expect(page.getByRole("button", { name: COPY["pt-BR"].revealAll })).toBeHidden();
  await ending.getByRole("button", { name: COPY["pt-BR"].saveMoment }).click();
  await expect(ending.getByRole("button", { name: COPY["pt-BR"].removeMoment })).toBeVisible();
  await ending.getByRole("button", { name: COPY["pt-BR"].removeMoment }).click();
  await expect(ending.getByRole("button", { name: COPY["pt-BR"].saveMoment })).toBeVisible();
});

test("the visible playhead score advances through the full comeback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
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

  await expect(page.getByTestId("score-card")).toBeHidden();
  await expect(page.getByTestId("turning-point")).toBeVisible();
});

test("playback updates in place and keeps keyboard controls stable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();

  const play = page.locator("#play");
  await play.focus();
  const originalPlay = await play.elementHandle();
  await page.keyboard.press("Space");
  await page.waitForTimeout(350);
  expect(await page.evaluate((element) => element === document.querySelector("#play"), originalPlay)).toBe(true);
  await expect(play).toBeFocused();
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "false");

  const scrubber = page.locator("#scrub");
  await scrubber.focus();
  const originalScrubber = await scrubber.elementHandle();
  await scrubber.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "2500";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await page.evaluate((element) => element === document.querySelector("#scrub"), originalScrubber)).toBe(true);
  await expect(scrubber).toBeFocused();
  await expect(scrubber).toHaveAttribute("aria-valuetext", "13%");
  await expect(page.getByTestId("score-card")).toContainText("1 — 0");
  await expect(page.getByTestId("timeline")).toContainText("Gol");
  const revealedFeedItems = page.getByTestId("timeline").locator("li:not(.empty)");
  await expect(revealedFeedItems).toHaveCount(2);
  await page.getByRole("button", { name: "Momentos" }).click();
  await expect(revealedFeedItems.nth(0)).toBeVisible();
  await expect(revealedFeedItems.nth(1)).toBeVisible();
});

test("rewinding before the turning point rearms auto-pause", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await setScrubber(page, 4_100);
  await setScrubber(page, 3_800);
  await expect(page.getByTestId("turning-point")).toHaveCount(0);
  await page.locator("#play").click();
  await expect(page.getByTestId("turning-point")).toContainText("Replay pausado automaticamente", { timeout: 2_000 });
});

test("turning point names the signal and keeps continuation in the card", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await expect(page.getByRole("button", { name: "Ir direto à Virada" })).toBeVisible();
  await setScrubber(page, 3_800);
  await page.getByRole("button", { name: "Continuar" }).click();

  const point = page.getByTestId("turning-point");
  await expect(point).toContainText("Replay pausado automaticamente", { timeout: 2_000 });
  const continueButton = point.getByRole("button", { name: "Continuar replay" });
  await expect(continueButton).toBeFocused();
  const continueBox = await continueButton.boundingBox();
  expect(continueBox).not.toBeNull();
  expect((continueBox?.y ?? 800) + (continueBox?.height ?? 0)).toBeLessThanOrEqual(800);
  await expect(point.getByTestId("proof-compact")).toContainText("Solana");
  await expect(point.getByTestId("proof-compact")).toContainText("Placar verificado na Solana");
  await expect(point).toContainText(COPY["pt-BR"].rarityLabel);
  await expect(point.locator(":scope > p:not(.auto-pause-note)")).toContainText("Dourado Teste");
  await expect(point.locator(":scope > p:not(.auto-pause-note)")).toContainText("+75,8 pp");

  await page.getByRole("button", { name: "Mudar idioma" }).click();
  await expect(point.locator(":scope > p:not(.auto-pause-note)")).toContainText("Dourado Teste");
  await expect(point.locator(":scope > p:not(.auto-pause-note)")).toContainText("+75.8 pp");
});

test("error state is a distinct accessible alert and marks TxLINE offline", async ({ page }) => {
  await page.route("**/api/replays/18241006", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "TXLINE_NETWORK_FAILED" } }),
    });
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(page.locator(".system-status")).toContainText("TXLINE INDISPONÍVEL");
  const copy = await alert.evaluate((element) => ({
    title: element.querySelector("h1")?.textContent?.trim(),
    detail: element.querySelector("p")?.textContent?.trim(),
  }));
  expect(copy.title).not.toBe(copy.detail);
  await expectCompleteAxePass(page);
});

test("public-safe mode offers the labeled demo without presenting a dead-end error", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/replays/18241006", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "TXLINE_CREDENTIALS_MISSING" } }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: COPY["pt-BR"].gatewayTitle })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".system-status")).toContainText(COPY["pt-BR"].demoReadyStatus);
  await expectNoHorizontalOverflow(page);
  await expectCompleteAxePass(page);
  await page.screenshot({ path: "test-results/app-public-gateway-390.png" });
  await page.getByRole("button", { name: COPY["pt-BR"].changeLanguage }).click();
  await expect(page.getByRole("heading", { name: COPY.en.gatewayTitle })).toBeVisible();
  await expectCompleteAxePass(page);
  await page.getByRole("button", { name: COPY.en.watchDemo }).click();
  await expect(page.getByTestId("source-banner")).toContainText(COPY.en.fictionalWarning);
});

test("a labeled fallback becomes available after three seconds without waiting for TxLINE", async ({ page }) => {
  await page.route("**/api/replays/18241006", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Você perdeu o jogo. Não perca a virada." })).toBeVisible();
  await expect(page.getByTestId("loading-match")).toContainText("18241006");
  const preparing = page.getByRole("button", { name: "Preparando replay" });
  await expect(preparing).toBeDisabled();
  const preparingBox = await preparing.boundingBox();
  expect((preparingBox?.y ?? 812) + (preparingBox?.height ?? 0)).toBeLessThanOrEqual(812);
  await page.screenshot({ path: "test-results/e2e-loading-375.png" });

  const fallback = page.getByRole("button", { name: COPY["pt-BR"].fictionalOpen });
  await expect(fallback).toBeVisible({ timeout: 3_400 });
  await fallback.click();
  await expect(page.getByTestId("source-banner")).toContainText(COPY["pt-BR"].fictionalWarning);
  await page.waitForTimeout(700);
  await expect(page.locator("body")).toHaveAttribute("data-source", "synthetic");
});

test("final continuity can restart the same honest replay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await page.getByRole("button", { name: "Revelar replay completo" }).click();
  const ending = page.getByTestId("replay-ending");
  await expect(ending).toBeVisible();
  await ending.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/e2e-ending-375.png" });
  await ending.getByRole("button", { name: "Guardar neste aparelho" }).click();
  await expect(ending.getByRole("button", { name: /Remover deste aparelho/ })).toHaveAttribute("aria-pressed", "true");
  await expect(ending).toContainText("sem conta, mint ou blockchain");
  const savedPayload = await page.evaluate(() => window.localStorage.getItem("torcida-pulse:saved-moments"));
  expect(savedPayload).not.toContain("18241006");
  expect(savedPayload).not.toContain("Dourado Teste");
  expect(JSON.parse(savedPayload ?? "{}")).toMatchObject({ saved: true });
  await ending.getByRole("button", { name: "Reviver esta partida" }).click();
  await expect(page.getByTestId("replay-ending")).toHaveCount(0);
  await expect(page.getByTestId("timeline")).toContainText("Início");
  await expect(page.getByTestId("timeline")).not.toContainText("Gol");
  await expect(page.getByTestId("score-card")).toContainText(COPY["pt-BR"].hiddenScore);
  await expect(page.getByRole("button", { name: "Reproduzir" })).toBeVisible();
});

test("judge access code stays in session memory and is sent only to the real route", async ({ page }) => {
  const seenAccess: Array<string | undefined> = [];
  await page.route("**/api/replays/18241006", async (route) => {
    const access = route.request().headers()["x-judge-access"];
    seenAccess.push(access);
    if (access === "judge-access-e2e-only") await route.continue();
    else {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "JUDGE_ACCESS_REQUIRED" } }),
      });
    }
  });
  await page.goto("/");
  await page.getByText(COPY["pt-BR"].judgeEntry).click();
  await expect(page.getByLabel("Código de acesso do jurado")).toBeVisible();
  await page.getByLabel("Código de acesso do jurado").fill("judge-access-e2e-only");
  await page.getByRole("button", { name: "Abrir replay real" }).click();
  await expect(page.getByTestId("match-card")).toBeVisible();
  expect(seenAccess).toEqual([undefined, "judge-access-e2e-only"]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
});

test("editorial picker holds at desktop, 320px, and in English", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("match-card")).toBeVisible();
  await expect(page.getByTestId("match-start")).toHaveAttribute("datetime", "2026-07-15T19:00:00.000Z");
  await expect(page.getByTestId("match-start")).toContainText("2026-07-15 16:00:00 GMT-3");
  await expect(page.getByTestId("match-start")).toHaveAttribute("data-timezone", "America/Sao_Paulo");

  const desktop = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>(".picker-hero h1");
    return {
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      headingSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
    };
  });
  expect(desktop.scroll).toBeLessThanOrEqual(desktop.inner);
  expect(desktop.headingSize).toBeGreaterThan(46);
  expect(desktop.headingSize).toBeLessThan(60);

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
      ctaBottom: cta?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(mobile.scroll).toBeLessThanOrEqual(mobile.inner);
  expect(mobile.headingSize).toBeGreaterThan(38);
  expect(mobile.ctaScrollWidth).toBeLessThanOrEqual(mobile.ctaClientWidth);
  expect(mobile.ctaBottom).toBeLessThanOrEqual(800);

  await page.getByRole("button", { name: "Mudar idioma" }).click();
  await expect(page.getByRole("heading", { name: "You missed the match. Don't miss the turning point." })).toBeVisible();
  const englishWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(englishWidth.scroll).toBeLessThanOrEqual(englishWidth.inner);

  await page.waitForTimeout(750); // Evaluate the settled design, not the 700ms entrance blend.
  const pickerAccessibility = await new AxeBuilder({ page }).analyze();
  expect(pickerAccessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("picker and replay use browser history without refetching the envelope", async ({ page }) => {
  let replayRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/replays/18241006") replayRequests += 1;
  });

  await page.goto("/");
  await expect(page.getByTestId("match-card")).toBeVisible();
  expect(replayRequests).toBe(1);

  await page.getByRole("button", { name: COPY["pt-BR"].openReplay }).click();
  await expect(page).toHaveURL(/\?view=replay$/);
  await expect(page.getByTestId("surface-live")).toBeVisible();

  await page.getByRole("button", { name: "Voltar ao jogo" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4310/");
  await expect(page.getByTestId("match-card")).toBeVisible();
  expect(replayRequests).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL(/\?view=replay$/);
  await expect(page.getByTestId("surface-live")).toBeVisible();
  expect(replayRequests).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL("http://127.0.0.1:4310/");
  await expect(page.getByTestId("match-card")).toBeVisible();
  expect(replayRequests).toBe(1);
});

test("Pulse favicon and large social preview metadata are deployable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Torcida Pulse/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /TxLINE/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/og-pulse.png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");

  const favicon = await request.get("/favicon.svg");
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  const socialPreview = await request.get("/og-pulse.png");
  expect(socialPreview.ok()).toBe(true);
  expect(socialPreview.headers()["content-type"]).toContain("image/png");
});

for (const viewport of MATRIX_VIEWPORTS) {
  for (const lang of MATRIX_LANGUAGES) {
    for (const matrixState of MATRIX_STATES) {
      test(`matrix ${viewport.name}px / ${lang} / ${matrixState} passes layout, dictionary, and full axe`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ reducedMotion: "reduce" });
        if (matrixState === "error") {
          await page.route("**/api/replays/18241006", async (route) => {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "TXLINE_NETWORK_FAILED",
                  message: "Credentials intentionally unavailable in this E2E state.",
                },
              }),
            });
          });
        }

        await page.goto("/");
        if (matrixState === "error") await expect(page.locator("#retry")).toBeVisible();
        else await expect(page.getByTestId("match-card")).toBeVisible();
        await chooseLanguage(page, lang);
        const t = COPY[lang];

        if (matrixState === "picker") {
          const cta = page.getByRole("button", { name: t.openReplay });
          await expect(cta).toBeVisible();
          const box = await cta.boundingBox();
          expect(box).not.toBeNull();
          expect((box?.y ?? viewport.height) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
        } else if (matrixState !== "error") {
          await page.getByRole("button", { name: t.openReplay }).click();
          await expect(page.getByTestId("timeline")).toContainText(t.actions.kick_off);
          if (matrixState === "initial") {
            await expect(page.getByTestId("timeline")).not.toContainText(t.actions.goal);
            await expect(page.getByTestId("score-card")).toContainText(t.hiddenScore);
          } else if (matrixState === "auto-pause") {
            await setScrubber(page, 3_800);
            await page.getByRole("button", { name: t.resume }).click();
            await expect(page.getByTestId("turning-point")).toContainText(t.autoPaused, { timeout: 2_000 });
            await page.getByRole("button", { name: t.tabProof, exact: true }).click();
            await expect(page.getByTestId("provenance").locator(".proof-details > summary")).toBeVisible();
            await expect(page.getByTestId("proof-explorer")).not.toBeVisible();
          } else {
            await page.getByRole("button", { name: t.revealAll }).click();
            await expect(page.getByTestId("score-card")).toContainText("1 — 2");
            await expect(page.getByTestId("timeline")).toContainText(t.actions.game_finalised);
          }
        } else {
          await expect(page.locator(".error-panel")).toContainText(t.loadFailed);
          await expect(page.getByRole("button", { name: t.fictionalOpen })).toBeVisible();
        }

        await expectNoHorizontalOverflow(page);
        await expectNoOppositeLanguageLiterals(page, lang);
        await expectCompleteAxePass(page);
        const unexpectedConsoleErrors = consoleErrors.filter((message) => !(
          matrixState === "error" && message.includes("status of 503")
        ));
        expect(unexpectedConsoleErrors).toEqual([]);

        if (matrixState === "final") {
          await setScrubber(page, 2_500);
          await expect(page.getByTestId("score-card")).toContainText("1 — 0");
          await expect(page.getByTestId("timeline")).not.toContainText(t.actions.game_finalised);
        }
        if (matrixState === "error") {
          await page.getByRole("button", { name: t.fictionalOpen }).click();
          await expect(page.getByTestId("source-banner")).toContainText(t.fictionalWarning);
          await expect(page.locator("body")).toHaveAttribute("data-source", "synthetic");
        }
      });
    }

    test(`keyboard controls work at ${viewport.name}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByTestId("match-card")).toBeVisible();
      if (lang === "en") {
        await page.getByRole("button", { name: COPY["pt-BR"].changeLanguage }).focus();
        await page.keyboard.press("Enter");
      }
      const t = COPY[lang];
      const cta = page.getByRole("button", { name: t.openReplay });
      await cta.focus();
      await expect(cta).toBeFocused();
      const pickerFocus = await cta.evaluate((element) => ({
        outlineColor: getComputedStyle(element).outlineColor,
        outlineWidth: getComputedStyle(element).outlineWidth,
        boxShadow: getComputedStyle(element).boxShadow,
      }));
      expect(pickerFocus).toMatchObject({ outlineColor: "rgb(9, 12, 10)", outlineWidth: "3px" });
      expect(pickerFocus.boxShadow).toContain("rgb(251, 252, 248)");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\?view=replay$/);

      const play = page.locator("#play");
      await play.focus();
      await page.keyboard.press("Space");
      await expect(play).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Space");
      await expect(page.locator("#play")).toHaveAttribute("aria-pressed", "true");

      const scrubber = page.locator("#scrub");
      await scrubber.focus();
      const initialPlayhead = Number(await scrubber.inputValue());
      await page.keyboard.press("ArrowRight");
      expect(Number(await scrubber.inputValue())).toBeGreaterThan(initialPlayhead);
      await page.keyboard.press("ArrowLeft");
      expect(Number(await scrubber.inputValue())).toBe(initialPlayhead);
    });
  }
}
