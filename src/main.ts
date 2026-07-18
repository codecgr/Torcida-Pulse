import "./styles.css";
import { copy, type Lang } from "./i18n";
import { ACTIVE_REPLAY_FIXTURE_ID } from "./replay-contract";
import { formatInTz, minuteLabel } from "./time";
import { scoreAt, visibleAt } from "./timeline";
import type { EndpointEvidence, ReplayEnvelope, ReplayEvent } from "./types";

type View = "loading" | "error" | "picker" | "replay";
type Surface = "live" | "moments" | "proof";
type State = {
  lang: Lang;
  view: View;
  replay: ReplayEnvelope | null;
  errorCode: string | null;
  fallbackAvailable: boolean;
  playheadMs: number;
  playing: boolean;
  autoPauseHandled: boolean;
  justAutoPaused: boolean;
  lastTick: number;
  surface: Surface;
};

const state: State = {
  lang: "pt-BR",
  view: "loading",
  replay: null,
  errorCode: null,
  fallbackAvailable: false,
  playheadMs: 0,
  playing: false,
  autoPauseHandled: false,
  justAutoPaused: false,
  lastTick: 0,
  surface: "live",
};

let timer: number | null = null;
let playbackFrame: number | null = null;
let focusAfterPlaybackUpdate = false;
let replayRequestSerial = 0;
let loadingFallbackTimer: number | null = null;
const JUDGE_ACCESS_STORAGE_KEY = "torcida-pulse:judge-access";
const MOMENT_MEMORY_STORAGE_KEY = "torcida-pulse:saved-moments";
const LOADING_FALLBACK_DELAY_MS = 3_000;

function viewFromLocation(): "picker" | "replay" {
  return new URL(window.location.href).searchParams.get("view") === "replay" ? "replay" : "picker";
}

function urlForView(view: "picker" | "replay"): string {
  const url = new URL(window.location.href);
  if (view === "replay") url.searchParams.set("view", "replay");
  else url.searchParams.delete("view");
  return `${url.pathname}${url.search}${url.hash}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateDocumentMetadata(): void {
  const t = copy(state.lang);
  document.title = t.documentTitle;
  const metadata: Array<[string, string]> = [
    ['meta[name="description"]', t.metaDescription],
    ['meta[property="og:locale"]', t.socialLocale],
    ['meta[property="og:title"]', t.socialTitle],
    ['meta[property="og:description"]', t.socialDescription],
    ['meta[property="og:image:alt"]', t.socialImageAlt],
    ['meta[name="twitter:title"]', t.socialTitle],
    ['meta[name="twitter:description"]', t.socialDescription],
  ];
  for (const [selector, value] of metadata) {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", value);
  }
}

function formattedTimestamp(value: number | string | null, timeZone: string): string {
  const timestamp = typeof value === "number" ? value : value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "—";
  const iso = new Date(timestamp).toISOString();
  return `<time datetime="${iso}" data-timezone="${escapeHtml(timeZone)}">${escapeHtml(formatInTz(timestamp, timeZone))}</time>`;
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function teamCode(name: string): string {
  const code = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").slice(0, 3);
  return code ? code.toUpperCase() : "—";
}

function isMomentSaved(_replay: ReplayEnvelope): boolean {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MOMENT_MEMORY_STORAGE_KEY) ?? "null") as unknown;
    return typeof stored === "object" && stored !== null && "saved" in stored && stored.saved === true;
  } catch {
    return false;
  }
}

function saveMomentLocally(): void {
  try {
    // Persist only the fan's preference and time. No TxLINE field or proof data is stored.
    window.localStorage.setItem(MOMENT_MEMORY_STORAGE_KEY, JSON.stringify({
      saved: true,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage may be disabled. The UI stays truthful by checking persistence after the write.
  }
}

function stopTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function startTimer(): void {
  if (timer !== null || !state.replay) return;
  state.lastTick = performance.now();
  timer = window.setInterval(() => {
    if (!state.playing || !state.replay) return;
    const now = performance.now();
    const next = Math.min(
      state.replay.playbackDurationMs,
      state.playheadMs + Math.max(0, now - state.lastTick)
    );
    state.lastTick = now;
    const momentAt = state.replay.turningPoint?.playbackMs;
    if (
      momentAt !== undefined &&
      !state.autoPauseHandled &&
      state.playheadMs < momentAt &&
      next >= momentAt
    ) {
      state.playheadMs = momentAt;
      state.playing = false;
      state.autoPauseHandled = true;
      state.justAutoPaused = true;
      state.surface = "live";
      stopTimer();
      schedulePlaybackDomUpdate(true);
      return;
    }
    state.playheadMs = next;
    if (next >= state.replay.playbackDurationMs) {
      state.playing = false;
      stopTimer();
    }
    schedulePlaybackDomUpdate();
  }, 100);
}

function navigateTo(view: "picker" | "replay", push = true): void {
  if (!state.replay) return;
  stopTimer();
  state.playing = false;
  state.justAutoPaused = false;
  if (view === "replay") state.surface = "live";
  state.view = view;
  if (push) window.history.pushState({ torcidaView: view }, "", urlForView(view));
  render();
}

async function requestReplay(path: string): Promise<void> {
  const requestSerial = ++replayRequestSerial;
  if (loadingFallbackTimer !== null) window.clearTimeout(loadingFallbackTimer);
  loadingFallbackTimer = null;
  stopTimer();
  state.view = "loading";
  state.errorCode = null;
  state.replay = null;
  state.fallbackAvailable = false;
  render();
  if (path.startsWith("/api/replays/")) {
    loadingFallbackTimer = window.setTimeout(() => {
      if (requestSerial !== replayRequestSerial || state.view !== "loading") return;
      state.fallbackAvailable = true;
      render();
    }, LOADING_FALLBACK_DELAY_MS);
  }
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (path.startsWith("/api/replays/")) {
      const judgeAccess = window.sessionStorage.getItem(JUDGE_ACCESS_STORAGE_KEY);
      if (judgeAccess) headers["X-Judge-Access"] = judgeAccess;
    }
    const response = await fetch(path, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await response.json()) as ReplayEnvelope | { error?: { code?: string } };
    if (requestSerial !== replayRequestSerial) return;
    if (!response.ok || !("schemaVersion" in body)) {
      state.errorCode = "error" in body && body.error?.code ? body.error.code : `HTTP_${response.status}`;
      state.view = "error";
    } else {
      state.replay = body;
      state.view = viewFromLocation();
      state.playheadMs = 0;
      state.playing = false;
      state.autoPauseHandled = false;
      state.justAutoPaused = false;
      state.surface = "live";
    }
  } catch (error) {
    if (requestSerial !== replayRequestSerial) return;
    state.errorCode = error instanceof DOMException && error.name === "TimeoutError"
      ? "BROWSER_TIMEOUT"
      : "NETWORK_FAILED";
    state.view = "error";
  } finally {
    if (requestSerial === replayRequestSerial && loadingFallbackTimer !== null) {
      window.clearTimeout(loadingFallbackTimer);
      loadingFallbackTimer = null;
    }
  }
  if (requestSerial !== replayRequestSerial) return;
  render();
}

function header(): string {
  const t = copy(state.lang);
  const offline = state.view === "error";
  return `<header class="app-header">
    <div class="brand-lockup"><div class="brand-sigil" aria-hidden="true"><b>P</b><i></i></div><div><div class="wordmark">Torcida <span>Pulse</span></div><p>${t.subtitle}</p></div></div>
    <div class="header-actions"><span class="system-status${offline ? " offline" : ""}"><i></i> ${offline ? t.txlineOffline : t.txlineStatus}</span><button id="lang" class="icon-button" aria-label="${t.changeLanguage}">${t.lang}</button></div>
  </header>`;
}

function loading(): string {
  const t = copy(state.lang);
  const fallback = state.fallbackAvailable
    ? `<div class="loading-fallback"><p>${t.loadingFallbackHint}</p><button class="primary" id="loading-fictional">${t.fictionalOpen}</button></div>`
    : "";
  return `<main class="loading-view"><section class="loading-promise">
    <span class="eyebrow">${t.loadingEyebrow}</span><h1>${t.promise} <em>${t.promiseAccent}</em></h1>
    <p role="status"><span class="loading-dot" aria-hidden="true"></span>${t.loading}</p>
  </section><section class="loading-match" data-testid="loading-match">
    <div><span>${t.loadingMatch}</span><strong>${t.loadingFixture} · ${ACTIVE_REPLAY_FIXTURE_ID}</strong></div>
    <div class="loading-score" aria-hidden="true"><i></i><b>— : —</b><i></i></div>
    <button class="primary" disabled>${t.loadingCta}</button>
  </section>${fallback}</main>`;
}

function errorView(): string {
  const t = copy(state.lang);
  const details: Record<string, string> = {
    TXLINE_CREDENTIALS_MISSING: t.missingCredentials,
    TXLINE_NETWORK_FAILED: t.networkFailed,
    TXLINE_TIMEOUT: t.networkFailed,
    BROWSER_TIMEOUT: t.networkFailed,
    TXLINE_AUTH_FAILED: t.authFailed,
    JUDGE_ACCESS_REQUIRED: t.judgeAccessRequired,
    JUDGE_ACCESS_NOT_CONFIGURED: t.judgeAccessNotConfigured,
    REAL_DATA_DISABLED: t.realDataDisabled,
    REAL_DATA_WINDOW_NOT_CONFIGURED: t.realDataWindowMissing,
    RATE_LIMITED: t.rateLimited,
  };
  const detail = details[state.errorCode ?? ""] ?? t.unexpectedFailure;
  const judgeAccess = state.errorCode === "JUDGE_ACCESS_REQUIRED"
    ? `<form id="judge-access-form" class="judge-access-form"><label for="judge-access">${t.judgeCode}</label><input id="judge-access" name="judge-access" type="password" required minlength="16" autocomplete="off" placeholder="${t.judgeCodePlaceholder}" /><button class="primary" type="submit">${t.judgeCodeSubmit}</button></form>`
    : "";
  return `<main><section class="hero error-panel" role="alert" aria-labelledby="error-title">
    <span class="eyebrow">${t.txlineOffline}</span><h1 id="error-title">${t.loadFailed}</h1><p>${detail}</p>
    <code class="error-code">${escapeHtml(state.errorCode)}</code>
    ${judgeAccess}
    <div class="button-stack"><button class="primary" id="retry">${t.retry}</button><button id="fictional">${t.fictionalOpen}</button></div>
  </section></main>`;
}

function sourceBanner(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  return replay.source.mode === "real_txline"
    ? `<div class="source-banner real" data-testid="source-banner"><span><i></i>${t.realSource}</span><b>${t.serverSideNoStore}</b></div>`
    : `<div class="source-banner synthetic" data-testid="source-banner">${t.fictionalWarning}</div>`;
}

function picker(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const team1 = escapeHtml(replay.match.participant1.name);
  const team2 = escapeHtml(replay.match.participant2.name);
  const durationSeconds = Math.round(replay.playbackDurationMs / 1000);
  const promiseDetail = t.promiseDetail.replace("{seconds}", String(durationSeconds));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const startDateTime = new Date(replay.match.startTime).toISOString();
  const startLabel = formatInTz(replay.match.startTime, timeZone);
  return `<main class="picker-page">${sourceBanner(replay)}<section class="hero picker-hero">
    <div class="hero-copy"><span class="eyebrow">${replay.source.mode === "real_txline" ? t.sourceReal : t.sourceSynthetic}</span>
    <h1><span>${t.promise}</span><em>${t.promiseAccent}</em></h1><p>${promiseDetail}</p></div>
    <div class="pulse-orbit" aria-hidden="true"><i></i><i></i><b>P</b></div>
  </section>
  <section class="match-card" data-testid="match-card">
    <div class="ticket-meta"><span>${t.matchNumber}</span><time data-testid="match-start" datetime="${startDateTime}" data-timezone="${escapeHtml(timeZone)}">${escapeHtml(startLabel)}</time><span>${escapeHtml(replay.match.competition ?? "")}</span></div>
    <div class="match-up"><div class="team"><span>${teamCode(replay.match.participant1.name)}</span><strong>${team1}</strong></div><div class="locked-score"><i aria-hidden="true">◉</i><b>— : —</b><small>${t.scoreLocked}</small></div><div class="team team-away"><span>${teamCode(replay.match.participant2.name)}</span><strong>${team2}</strong></div></div>
    <div class="ticket-action"><div><span class="eyebrow">${t.ready}</span><strong>${durationSeconds}s</strong></div><button class="primary" id="open-replay">${t.openReplay}<span aria-hidden="true">→</span></button></div>
  </section>
  ${replay.source.mode === "synthetic" ? `<button class="text-button" id="back-real">${t.backReal}</button>` : ""}
  </main>`;
}

function controls(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  const durationClock = formatClock(replay.playbackDurationMs);
  const currentPlayLabel = state.playing
    ? t.pause
    : state.playheadMs >= replay.playbackDurationMs
      ? t.restart
      : state.playheadMs > 0
        ? t.resume
        : t.play;
  return `<section class="replay-controls" aria-label="${t.replayControls}">
    <div class="hud-meta"><span>${t.replayStatus}</span><strong id="progress">${String(progress).padStart(2, "0")}%</strong></div>
    <div class="control-row">
      <button class="play" id="play" aria-pressed="${state.playing}"><span id="play-icon" aria-hidden="true">${state.playing ? "Ⅱ" : "▶"}</span><span id="play-label">${currentPlayLabel}</span></button>
    <div class="clock" id="clock" aria-live="off"><span id="clock-current">${formatClock(state.playheadMs)}</span> <span>/ ${durationClock}</span></div>
    </div>
    <label class="scrubber"><span class="sr-only">${t.replayPosition}</span><input id="scrub" type="range" min="0" max="${replay.playbackDurationMs}" step="100" value="${Math.round(state.playheadMs)}" aria-valuetext="${progress}%" /></label>
    <div class="replay-shortcuts">${replay.turningPoint ? `<button class="reveal jump-moment" id="jump-moment">${t.jumpMoment}</button>` : ""}<button class="reveal" id="reveal-all">${t.revealAll}</button></div>
  </section>`;
}

function eventLabel(event: ReplayEvent): string {
  const t = copy(state.lang);
  const known = t.actions[event.action as keyof typeof t.actions];
  return known ?? t.unknownEvent;
}

function scoreboard(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const score = state.playheadMs > 0 ? scoreAt(replay.events, state.playheadMs) : null;
  const available = Boolean(score && score.participant1 !== null && score.participant2 !== null);
  const scoreMarkup = available ? `${score?.participant1} <i>—</i> ${score?.participant2}` : `<span aria-hidden="true">—</span> <i>:</i> <span aria-hidden="true">—</span><small>${t.hiddenScore}</small>`;
  return `<section class="score-card${available ? "" : " locked"}" data-testid="score-card"><div class="score-kicker"><span>${t.replayStatus}</span><i>${available ? t.liveAtPlayhead : t.safe}</i></div><div class="score-grid"><div><small>${teamCode(replay.match.participant1.name)}</small><strong>${escapeHtml(replay.match.participant1.name)}</strong></div><b>${scoreMarkup}</b><div><small>${teamCode(replay.match.participant2.name)}</small><strong>${escapeHtml(replay.match.participant2.name)}</strong></div></div></section>`;
}

function livePulse(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const events = visibleAt(replay.events, state.playheadMs);
  const latest = events[events.length - 1];
  const pointVisible = Boolean(replay.turningPoint && state.playheadMs >= replay.turningPoint.playbackMs);
  if (pointVisible) return "";
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  return `<section class="live-pulse" data-testid="live-pulse">
    <div class="pulse-visual" aria-hidden="true"><svg viewBox="0 0 100 100"><circle class="pulse-track" cx="50" cy="50" r="39"/><circle class="pulse-progress" cx="50" cy="50" r="39" pathLength="100" stroke-dasharray="${progress} 100"/></svg><i></i><b>P</b></div>
    <div class="pulse-copy"><span class="eyebrow">${t.signalPulse} · ${events.length} ${t.eventsRevealed}</span><h2>${t.pulseListening}</h2><p>${latest ? `<strong>${t.lastEvent}: ${minuteLabel(latest.minute)} · ${escapeHtml(eventLabel(latest))}</strong>` : t.pulseListeningDetail}</p></div>
  </section>`;
}

function timeline(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const events = visibleAt(replay.events, state.playheadMs);
  const rows = events.map((event) => `<li data-seq="${event.seq}">
    <time>${minuteLabel(event.minute)}</time>
    <div><strong>${escapeHtml(eventLabel(event))}</strong>${event.participantName ? `<span>${escapeHtml(event.participantName)}</span>` : ""}${event.corrected ? `<em>${t.corrected}</em>` : ""}</div>
  </li>`).join("");
  return `<section class="panel timeline-panel"><header class="section-head"><span>${t.eventFeed}</span><h2>${t.timeline}</h2><small>${events.length} ${t.eventsRevealed}</small></header><ol data-testid="timeline">${rows || `<li class="empty">${t.noEvents}</li>`}</ol></section>`;
}

function turningPoint(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const point = replay.turningPoint;
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  if (!point) {
    const reason = replay.turningPointReason === "odds_unavailable" ? t.oddsUnavailable : t.noMoment;
    return atEnd ? `<section class="panel honest-empty" data-testid="no-moment"><h2>${t.moment}</h2><p>${reason}</p></section>` : "";
  }
  if (state.playheadMs < point.playbackMs) return "";
  const movement = point.movement;
  const delta = movement.after.pct - movement.before.pct;
  const formattedDelta = `${delta >= 0 ? "+" : ""}${new Intl.NumberFormat(state.lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(delta)}`;
  const sentence = t.coincided
    .replace("{minute}", minuteLabel(point.minute))
    .replace("{event}", escapeHtml(eventLabel({ action: point.action } as ReplayEvent)).toLowerCase())
    .replace("{participant}", escapeHtml(point.participantName ?? movement.tuple.priceName))
    .replace("{before}", movement.before.pct.toFixed(1))
    .replace("{after}", movement.after.pct.toFixed(1))
    .replace("{price}", escapeHtml(movement.tuple.priceName))
    .replace("{delta}", formattedDelta);
  const momentScore = scoreAt(replay.events, point.playbackMs);
  const momentMinute = minuteLabel(point.minute);
  const momentScoreMarkup = momentScore && momentScore.participant1 !== null && momentScore.participant2 !== null
    ? `<div class="moment-score"><em class="moment-score-label">${t.momentScoreAt.replace("{minute}", momentMinute)}</em><span><b>${teamCode(replay.match.participant1.name)}</b><small>${escapeHtml(replay.match.participant1.name)}</small></span><strong>${momentScore.participant1} — ${momentScore.participant2}</strong><span class="away"><b>${teamCode(replay.match.participant2.name)}</b><small>${escapeHtml(replay.match.participant2.name)}</small></span></div>`
    : "";
  const compactProof = t.proofCompact[replay.provenance.state];
  const proofSymbol = replay.provenance.state === "verified" ? "✓" : "○";
  const rarityReason = t.rarityReason.replace("{delta}", formattedDelta);
  return `<section class="turning-point${state.justAutoPaused ? " auto-paused" : ""}" data-testid="turning-point">
    <div class="moment-burst" aria-hidden="true"><i></i><i></i><b>${momentMinute}</b></div><div class="moment-top"><span class="eyebrow">${t.moment}</span><strong>${momentMinute}</strong></div><h2>${t.momentHeadline}</h2>
    ${state.justAutoPaused ? `<p class="auto-pause-note">${t.autoPaused}</p>` : ""}
    ${momentScoreMarkup}
    <div class="movement"><span><small>${t.before}</small><b>${movement.before.pct.toFixed(1)}<sup>%</sup></b></span><i aria-hidden="true">→</i><strong><small>${t.after}</small><b>${movement.after.pct.toFixed(1)}<sup>%</sup></b></strong></div>
    <div class="rarity-callout"><span>${t.rarityLabel}</span><strong>${formattedDelta} pp</strong><p>${rarityReason}</p></div>
    <p>${sentence}</p>
    <button class="proof-compact ${replay.provenance.state}" id="view-proof" data-testid="proof-compact"><span aria-hidden="true">${proofSymbol}</span><strong>${compactProof}</strong><em>${t.proofCompactAction} ↗</em></button>
    <div class="moment-actions">${state.playheadMs < replay.playbackDurationMs ? `<button id="continue-replay">${t.continueReplay}</button>` : ""}<button id="share-moment">${t.shareMoment}</button></div>
  </section>`;
}

function endpointName(endpoint: EndpointEvidence): string {
  const t = copy(state.lang);
  return {
    fixtures_snapshot: "fixtures/snapshot",
    scores_historical: "scores/historical",
    odds_before: `odds/snapshot · ${t.endpointBefore}`,
    odds_after: `odds/snapshot · ${t.endpointAfter}`,
    scores_stat_validation: "scores/stat-validation",
  }[endpoint.id];
}

function provenance(replay: ReplayEnvelope): string {
  const pointAt = replay.turningPoint?.playbackMs ?? replay.playbackDurationMs;
  const t = copy(state.lang);
  if (state.playheadMs < pointAt) return `<section class="proof-locked"><div class="proof-lock-icon" aria-hidden="true">◇</div><span class="eyebrow">${t.tabProof}</span><h2>${t.proofLocked}</h2><p>${t.proofLockedDetail}</p></section>`;
  const [title, detail] = t.proof[replay.provenance.state];
  const endpoints = replay.source.endpoints.map((endpoint) => `<li><code>${endpointName(endpoint)}</code><span class="http ${endpoint.status >= 200 && endpoint.status < 300 ? "ok" : "bad"}">${endpoint.status || t.requestErrorShort}</span></li>`).join("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const pda = replay.provenance.dailyScoresPda;
  const explorerUrl = pda && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pda)
    ? `https://explorer.solana.com/address/${pda}?cluster=devnet`
    : null;
  const tuple = replay.turningPoint
    ? [replay.turningPoint.movement.tuple.bookmakerId, replay.turningPoint.movement.tuple.superOddsType, replay.turningPoint.movement.tuple.marketPeriod, replay.turningPoint.movement.tuple.marketParameters, replay.turningPoint.movement.tuple.priceName]
      .map((value) => escapeHtml(value ?? "∅"))
      .join(" · ")
    : "—";
  return `<section class="panel provenance" data-testid="provenance">
    <header class="section-head"><span>${t.trustLayer}</span><h2>${t.provenance}</h2></header><div class="proof-badge ${replay.provenance.state}" data-proof-state="${replay.provenance.state}"><span></span><strong>${title}</strong></div><p>${detail}</p>
    <details class="proof-details"><summary>${t.proofReveal}<span aria-hidden="true">＋</span></summary><div class="proof-body">
      ${replay.source.mode === "real_txline" ? `<dl><div><dt>${t.programLabel}</dt><dd><code>${escapeHtml(replay.provenance.programId)}</code></dd></div><div><dt>${t.sequenceStatsLabel}</dt><dd><code>${replay.provenance.seq ?? "—"} / ${replay.provenance.statKeys.join(",")}</code></dd></div><div><dt>${t.epochDayLabel}</dt><dd><code>${replay.provenance.epochDay ?? "—"}</code></dd></div><div><dt>${t.dailyScoresPdaLabel}</dt><dd><code>${escapeHtml(pda ?? "—")}</code></dd></div><div><dt>${t.proofTargetLabel}</dt><dd>${formattedTimestamp(replay.provenance.proofTargetTs, timeZone)}</dd></div><div><dt>${t.checkedAtLabel}</dt><dd>${formattedTimestamp(replay.provenance.checkedAt, timeZone)}</dd></div></dl>${explorerUrl ? `<a class="explorer-link" data-testid="proof-explorer" href="${explorerUrl}" target="_blank" rel="noreferrer noopener">${t.explorerLink}</a>` : ""}<p class="simulation-note">${t.readOnlySimulation}</p><h3>${t.endpointEvidence}</h3><ul class="endpoints" data-testid="endpoints">${endpoints}</ul>` : ""}
      <h3>${t.tuple}</h3><code class="proof-tuple">${tuple}</code><small>${t.nonCausal}</small><small>${t.rawOmitted}</small>
    </div></details>
  </section>`;
}

function ending(replay: ReplayEnvelope): string {
  if (state.playheadMs < replay.playbackDurationMs) return "";
  const t = copy(state.lang);
  const minute = replay.turningPoint ? minuteLabel(replay.turningPoint.minute) : "—";
  const saved = isMomentSaved(replay);
  return `<section class="panel replay-ending" data-testid="replay-ending">
    <div class="ending-copy"><span class="eyebrow">04 / ${t.endingEyebrow}</span><h2>${t.endingTitle}</h2><p>${t.endingDetail}</p>
      <div class="ending-actions"><button class="primary" id="ending-share">${t.shareMoment}</button><button id="replay-again">${t.replayAgain}</button></div>
      <button class="save-moment${saved ? " saved" : ""}" id="save-moment" aria-pressed="${saved}">${saved ? `✓ ${t.momentSaved}` : t.saveMoment}</button><small class="save-local-note">${t.saveLocalNote}</small>
      <button class="next-moment" disabled aria-describedby="next-moment-note">${t.nextMoment}</button><small id="next-moment-note">${t.nextUnavailable}</small>
    </div>
    <div class="memory-card" aria-label="${t.collectibleLabel}"><span>${t.collectibleLabel}</span><strong>${teamCode(replay.match.participant1.name)} <i>×</i> ${teamCode(replay.match.participant2.name)}</strong><b>${minute}</b><small>${t.collectibleConcept}</small></div>
  </section>`;
}

function scoreRenderKey(replay: ReplayEnvelope): string {
  const score = state.playheadMs > 0 ? scoreAt(replay.events, state.playheadMs) : null;
  return `${state.lang}:${score?.participant1 ?? "x"}:${score?.participant2 ?? "x"}`;
}

function timelineRenderKey(replay: ReplayEnvelope): string {
  return `${state.lang}:${visibleAt(replay.events, state.playheadMs)
    .map((event) => `${event.id}:${event.corrected ? 1 : 0}`)
    .join("|")}`;
}

function turningRenderKey(replay: ReplayEnvelope): string {
  const pointVisible = replay.turningPoint ? state.playheadMs >= replay.turningPoint.playbackMs : false;
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  return `${state.lang}:${pointVisible ? 1 : 0}:${atEnd ? 1 : 0}:${state.justAutoPaused ? 1 : 0}:${replay.turningPointReason ?? "moment"}`;
}

function provenanceRenderKey(replay: ReplayEnvelope): string {
  const pointAt = replay.turningPoint?.playbackMs ?? replay.playbackDurationMs;
  return `${state.lang}:${state.playheadMs >= pointAt ? 1 : 0}:${replay.provenance.state}`;
}

function pulseRenderKey(replay: ReplayEnvelope): string {
  return `${timelineRenderKey(replay)}:${turningRenderKey(replay)}:${Math.round((state.playheadMs / replay.playbackDurationMs) * 20)}`;
}

function endingRenderKey(replay: ReplayEnvelope): string {
  return `${state.lang}:${state.playheadMs >= replay.playbackDurationMs ? 1 : 0}:${isMomentSaved(replay) ? 1 : 0}`;
}

function updateReplayPhase(replay: ReplayEnvelope): void {
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  const atMoment = Boolean(replay.turningPoint && state.playheadMs >= replay.turningPoint.playbackMs);
  document.body.dataset.replayPhase = atEnd ? "final" : atMoment ? "moment" : "playing";
}

function updateDynamicSlot(id: string, key: string, markup: string): boolean {
  const slot = document.querySelector<HTMLElement>(`#${id}`);
  if (!slot || slot.dataset.key === key) return false;
  slot.dataset.key = key;
  slot.innerHTML = markup;
  return true;
}

function currentPlayLabel(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  if (state.playing) return t.pause;
  if (state.playheadMs >= replay.playbackDurationMs) return t.restart;
  if (state.playheadMs > 0) return t.resume;
  return t.play;
}

function focusAutoPauseContinuation(): void {
  const point = document.querySelector<HTMLElement>('[data-testid="turning-point"]');
  const continuation = document.querySelector<HTMLButtonElement>("#continue-replay");
  if (!point || !continuation) return;
  point.scrollIntoView({ block: "start", behavior: "auto" });
  continuation.focus({ preventScroll: true });
}

function activateSurface(surface: Surface, focusTab = false): void {
  const changed = state.surface !== surface;
  state.surface = surface;
  document.body.dataset.surface = surface;
  for (const panel of document.querySelectorAll<HTMLElement>("[data-surface-panel]")) {
    panel.hidden = panel.dataset.surfacePanel !== surface;
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-surface]")) {
    const selected = tab.dataset.surface === surface;
    tab.setAttribute("aria-current", selected ? "page" : "false");
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus({ preventScroll: true });
  }
  if (changed) window.scrollTo({ top: 0, behavior: "auto" });
}

function updatePlaybackDom(focusContinuation = false): void {
  const replay = state.replay;
  if (!replay || state.view !== "replay") return;
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  updateReplayPhase(replay);
  const play = document.querySelector<HTMLButtonElement>("#play");
  play?.setAttribute("aria-pressed", String(state.playing));
  const icon = document.querySelector<HTMLElement>("#play-icon");
  if (icon) icon.textContent = state.playing ? "Ⅱ" : "▶";
  const label = document.querySelector<HTMLElement>("#play-label");
  if (label) label.textContent = currentPlayLabel(replay);
  const progressNode = document.querySelector<HTMLElement>("#progress");
  if (progressNode) progressNode.textContent = `${String(progress).padStart(2, "0")}%`;
  const clock = document.querySelector<HTMLElement>("#clock-current");
  if (clock) clock.textContent = formatClock(state.playheadMs);
  const scrub = document.querySelector<HTMLInputElement>("#scrub");
  if (scrub) {
    scrub.value = String(Math.round(state.playheadMs));
    scrub.setAttribute("aria-valuetext", `${progress}%`);
  }

  const dynamicChanged = [
    updateDynamicSlot("score-slot", scoreRenderKey(replay), scoreboard(replay)),
    updateDynamicSlot("pulse-slot", pulseRenderKey(replay), livePulse(replay)),
    updateDynamicSlot("turning-slot", turningRenderKey(replay), turningPoint(replay)),
    updateDynamicSlot("timeline-slot", timelineRenderKey(replay), timeline(replay)),
    updateDynamicSlot("provenance-slot", provenanceRenderKey(replay), provenance(replay)),
    updateDynamicSlot("ending-slot", endingRenderKey(replay), ending(replay)),
  ].some(Boolean);
  if (dynamicChanged) bindDynamicControls();
  const announcer = document.querySelector<HTMLElement>("#announcer");
  if (announcer) announcer.textContent = state.justAutoPaused ? copy(state.lang).autoPaused : "";
  if (focusContinuation) {
    activateSurface("live");
    window.requestAnimationFrame(focusAutoPauseContinuation);
  }
}

function schedulePlaybackDomUpdate(focusContinuation = false): void {
  focusAfterPlaybackUpdate ||= focusContinuation;
  if (playbackFrame !== null) return;
  playbackFrame = window.requestAnimationFrame(() => {
    playbackFrame = null;
    const shouldFocus = focusAfterPlaybackUpdate;
    focusAfterPlaybackUpdate = false;
    updatePlaybackDom(shouldFocus);
  });
}

function replayView(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const hidden = (surface: Surface) => state.surface === surface ? "" : " hidden";
  return `<main class="replay-page">${sourceBanner(replay)}<section class="replay-head"><button class="back-to-picker" id="back-to-picker" aria-label="${t.backToMatch}"><span aria-hidden="true">←</span></button><div class="replay-title"><span>${t.safe}</span><h1>${teamCode(replay.match.participant1.name)} <i>×</i> ${teamCode(replay.match.participant2.name)}</h1></div><div class="live-chip"><i></i>${t.replayStatus}</div></section>
    <div class="surface-stack">
      <section class="app-surface live-surface" data-testid="surface-live" data-surface-panel="live"${hidden("live")}><div id="score-slot" data-key="${scoreRenderKey(replay)}">${scoreboard(replay)}</div><div id="pulse-slot" data-key="${pulseRenderKey(replay)}">${livePulse(replay)}</div><div id="turning-slot" data-key="${turningRenderKey(replay)}">${turningPoint(replay)}</div><div id="ending-slot" data-key="${endingRenderKey(replay)}">${ending(replay)}</div></section>
      <section class="app-surface moments-surface" data-testid="surface-moments" data-surface-panel="moments"${hidden("moments")}><div id="timeline-slot" data-key="${timelineRenderKey(replay)}">${timeline(replay)}</div></section>
      <section class="app-surface proof-surface" data-testid="surface-proof" data-surface-panel="proof"${hidden("proof")}><div id="provenance-slot" data-key="${provenanceRenderKey(replay)}">${provenance(replay)}</div></section>
    </div>
    ${controls(replay)}
    <nav class="app-tabs" aria-label="${t.appNavLabel}">
      <button data-surface="live" aria-current="${state.surface === "live" ? "page" : "false"}"${state.surface === "live" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">◉</span><strong>${t.tabLive}</strong></button>
      <button data-surface="moments" aria-current="${state.surface === "moments" ? "page" : "false"}"${state.surface === "moments" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">≋</span><strong>${t.tabMoments}</strong></button>
      <button data-surface="proof" aria-current="${state.surface === "proof" ? "page" : "false"}"${state.surface === "proof" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">◇</span><strong>${t.tabProof}</strong></button>
    </nav>
  </main>`;
}

function render(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  if (playbackFrame !== null) window.cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
  focusAfterPlaybackUpdate = false;
  const focusedId = document.activeElement instanceof HTMLElement && app.contains(document.activeElement)
    ? document.activeElement.id
    : "";
  document.documentElement.lang = state.lang;
  updateDocumentMetadata();
  document.body.dataset.view = state.view;
  document.body.dataset.source = state.replay?.source.mode ?? "pending";
  if (state.replay && state.view === "replay") updateReplayPhase(state.replay);
  else delete document.body.dataset.replayPhase;
  let body = loading();
  if (state.view === "error") body = errorView();
  else if (state.view === "picker" && state.replay) body = picker(state.replay);
  else if (state.view === "replay" && state.replay) body = replayView(state.replay);
  app.innerHTML = `<div class="app-shell" data-testid="app-shell">${header()}${body}<div id="announcer" class="sr-only" aria-live="polite">${state.justAutoPaused ? copy(state.lang).autoPaused : ""}</div></div>`;
  bind();
  if (state.view === "replay") activateSurface(state.surface);
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  if (state.justAutoPaused) {
    window.requestAnimationFrame(focusAutoPauseContinuation);
  }
}

function togglePlayback(): void {
  if (!state.replay) return;
  state.justAutoPaused = false;
  if (state.playheadMs >= state.replay.playbackDurationMs) {
    state.playheadMs = 0;
    state.autoPauseHandled = false;
  }
  state.playing = !state.playing;
  if (state.playing) startTimer();
  else stopTimer();
  schedulePlaybackDomUpdate();
}

function continueReplay(): void {
  if (!state.replay) return;
  state.justAutoPaused = false;
  state.playing = true;
  startTimer();
  schedulePlaybackDomUpdate();
}

function shareCurrentMoment(): void {
  const t = copy(state.lang);
  const text = document.querySelector<HTMLElement>('[data-testid="turning-point"] > p')?.textContent?.trim() ?? t.socialDescription;
  const shareData = { title: t.socialTitle, text, url: `${window.location.origin}${window.location.pathname}` };
  void (async () => {
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        const announcer = document.querySelector<HTMLElement>("#announcer");
        if (announcer) announcer.textContent = t.shared;
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) return;
    }
  })();
}

function bindDynamicControls(): void {
  const continuation = document.querySelector<HTMLButtonElement>("#continue-replay");
  if (continuation && continuation.dataset.bound !== "true") {
    continuation.dataset.bound = "true";
    continuation.addEventListener("click", continueReplay);
  }
  for (const share of document.querySelectorAll<HTMLButtonElement>("#share-moment, #ending-share")) {
    if (share.dataset.bound === "true") continue;
    share.dataset.bound = "true";
    share.addEventListener("click", shareCurrentMoment);
  }
  const viewProof = document.querySelector<HTMLButtonElement>("#view-proof");
  if (viewProof && viewProof.dataset.bound !== "true") {
    viewProof.dataset.bound = "true";
    viewProof.addEventListener("click", () => {
      activateSurface("proof");
      const proof = document.querySelector<HTMLElement>('[data-testid="provenance"]');
      const details = proof?.querySelector<HTMLDetailsElement>(".proof-details");
      if (!proof || !details) return;
      details.open = true;
      window.setTimeout(() => details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true }), 0);
    });
  }
  const saveMoment = document.querySelector<HTMLButtonElement>("#save-moment");
  if (saveMoment && saveMoment.dataset.bound !== "true") {
    saveMoment.dataset.bound = "true";
    saveMoment.addEventListener("click", () => {
      if (!state.replay) return;
      saveMomentLocally();
      updateDynamicSlot("ending-slot", endingRenderKey(state.replay), ending(state.replay));
      bindDynamicControls();
      document.querySelector<HTMLButtonElement>("#save-moment")?.focus({ preventScroll: true });
    });
  }
  const replayAgain = document.querySelector<HTMLButtonElement>("#replay-again");
  if (replayAgain && replayAgain.dataset.bound !== "true") {
    replayAgain.dataset.bound = "true";
    replayAgain.addEventListener("click", () => {
      stopTimer();
      state.playing = false;
      state.playheadMs = 0;
      state.autoPauseHandled = false;
      state.justAutoPaused = false;
      activateSurface("live");
      schedulePlaybackDomUpdate();
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }
}

function bind(): void {
  document.querySelector("#lang")?.addEventListener("click", () => {
    state.lang = state.lang === "pt-BR" ? "en" : "pt-BR";
    render();
  });
  document.querySelector("#retry")?.addEventListener("click", () => void requestReplay(`/api/replays/${ACTIVE_REPLAY_FIXTURE_ID}`));
  document.querySelector("#fictional")?.addEventListener("click", () => void requestReplay("/api/demo"));
  document.querySelector("#loading-fictional")?.addEventListener("click", () => void requestReplay("/api/demo"));
  document.querySelector("#back-real")?.addEventListener("click", () => void requestReplay(`/api/replays/${ACTIVE_REPLAY_FIXTURE_ID}`));
  document.querySelector("#judge-access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.querySelector<HTMLInputElement>("#judge-access")?.value.trim();
    if (!value) return;
    window.sessionStorage.setItem(JUDGE_ACCESS_STORAGE_KEY, value);
    void requestReplay(`/api/replays/${ACTIVE_REPLAY_FIXTURE_ID}`);
  });
  document.querySelector("#open-replay")?.addEventListener("click", () => {
    state.playheadMs = 0;
    state.autoPauseHandled = false;
    navigateTo("replay");
  });
  document.querySelector("#back-to-picker")?.addEventListener("click", () => navigateTo("picker"));
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-surface]")) {
    tab.addEventListener("click", () => activateSurface(tab.dataset.surface as Surface));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const order: Surface[] = ["live", "moments", "proof"];
      const current = order.indexOf(tab.dataset.surface as Surface);
      const next = (current + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length;
      activateSurface(order[next], true);
    });
  }
  document.querySelector("#play")?.addEventListener("click", togglePlayback);
  const scrub = document.querySelector<HTMLInputElement>("#scrub");
  scrub?.addEventListener("input", (event) => {
    stopTimer();
    state.playing = false;
    state.justAutoPaused = false;
    state.playheadMs = Number((event.currentTarget as HTMLInputElement).value);
    state.autoPauseHandled = Boolean(
      state.replay?.turningPoint && state.playheadMs >= state.replay.turningPoint.playbackMs
    );
    schedulePlaybackDomUpdate();
  });
  scrub?.addEventListener("change", () => schedulePlaybackDomUpdate());
  document.querySelector("#jump-moment")?.addEventListener("click", () => {
    if (!state.replay?.turningPoint) return;
    stopTimer();
    state.playing = false;
    state.justAutoPaused = true;
    state.autoPauseHandled = true;
    state.playheadMs = state.replay.turningPoint.playbackMs;
    activateSurface("live");
    schedulePlaybackDomUpdate(true);
  });
  document.querySelector("#reveal-all")?.addEventListener("click", () => {
    if (!state.replay) return;
    stopTimer();
    state.playing = false;
    state.justAutoPaused = false;
    state.autoPauseHandled = true;
    state.playheadMs = state.replay.playbackDurationMs;
    activateSurface("live");
    schedulePlaybackDomUpdate();
  });
  bindDynamicControls();
}

const initialHistoryState = window.history.state && typeof window.history.state === "object"
  ? window.history.state as Record<string, unknown>
  : {};
window.history.replaceState({ ...initialHistoryState, torcidaView: viewFromLocation() }, "", window.location.href);
window.addEventListener("popstate", () => {
  if (state.replay) navigateTo(viewFromLocation(), false);
});

void requestReplay(`/api/replays/${ACTIVE_REPLAY_FIXTURE_ID}`);
