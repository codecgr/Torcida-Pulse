import "./styles.css";
import { copy, type Lang } from "./i18n";
import { FROZEN_FIXTURE_ID } from "./replay-contract";
import { formatInTz, minuteLabel } from "./time";
import { scoreAt, visibleAt } from "./timeline";
import type { EndpointEvidence, ReplayEnvelope, ReplayEvent } from "./types";

type View = "loading" | "error" | "picker" | "replay";
type State = {
  lang: Lang;
  view: View;
  replay: ReplayEnvelope | null;
  errorCode: string | null;
  playheadMs: number;
  playing: boolean;
  autoPauseHandled: boolean;
  justAutoPaused: boolean;
  lastTick: number;
};

const state: State = {
  lang: "pt-BR",
  view: "loading",
  replay: null,
  errorCode: null,
  playheadMs: 0,
  playing: false,
  autoPauseHandled: false,
  justAutoPaused: false,
  lastTick: 0,
};

let timer: number | null = null;

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
      stopTimer();
      render();
      return;
    }
    state.playheadMs = next;
    if (next >= state.replay.playbackDurationMs) {
      state.playing = false;
      stopTimer();
    }
    render();
  }, 100);
}

function navigateTo(view: "picker" | "replay", push = true): void {
  if (!state.replay) return;
  stopTimer();
  state.playing = false;
  state.justAutoPaused = false;
  state.view = view;
  if (push) window.history.pushState({ torcidaView: view }, "", urlForView(view));
  render();
}

async function requestReplay(path: string): Promise<void> {
  stopTimer();
  state.view = "loading";
  state.errorCode = null;
  state.replay = null;
  render();
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    const body = (await response.json()) as ReplayEnvelope | { error?: { code?: string } };
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
    }
  } catch {
    state.errorCode = "NETWORK_FAILED";
    state.view = "error";
  }
  render();
}

function header(): string {
  const t = copy(state.lang);
  return `<header class="app-header">
    <div class="brand-lockup"><div class="brand-sigil" aria-hidden="true"><b>P</b><i></i></div><div><div class="wordmark">Torcida <span>Pulse</span></div><p>${t.subtitle}</p></div></div>
    <div class="header-actions"><span class="system-status"><i></i> ${t.txlineStatus}</span><button id="lang" class="icon-button" aria-label="${t.changeLanguage}">${t.lang}</button></div>
  </header>`;
}

function loading(): string {
  return `<main><section class="hero"><div class="pulse-loader" aria-hidden="true"></div><p role="status">${copy(state.lang).loading}</p></section></main>`;
}

function errorView(): string {
  const t = copy(state.lang);
  const detail = state.errorCode === "TXLINE_CREDENTIALS_MISSING" ? t.missingCredentials : t.loadFailed;
  return `<main><section class="hero error-panel">
    <span class="eyebrow">${t.txlineOffline}</span><h1>${t.loadFailed}</h1><p>${detail}</p>
    <code class="error-code">${escapeHtml(state.errorCode)}</code>
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
    <div class="pulse-mark" aria-hidden="true"><div class="pulse-axis x"></div><div class="pulse-axis y"></div><div class="pulse-ring outer"><i></i><i></i></div><div class="pulse-ring inner"></div><div class="pulse-core"><b>P</b><small>${t.signalPulse}</small></div><span class="pulse-label one">${t.signalPlay}</span><span class="pulse-label two">${t.signalPulse}</span><span class="pulse-label three">${t.signalProof}</span></div>
  </section>
  <section class="match-card" data-testid="match-card">
    <div class="ticket-meta"><span>${t.matchNumber}</span><time data-testid="match-start" datetime="${startDateTime}" data-timezone="${escapeHtml(timeZone)}">${t.matchStart} · ${escapeHtml(startLabel)}</time><span>${escapeHtml(replay.match.competition ?? "")}</span></div>
    <div class="match-up"><div class="team"><span>${teamCode(replay.match.participant1.name)}</span><strong>${team1}</strong></div><div class="locked-score"><b>— : —</b><small>${t.scoreLocked}</small></div><div class="team team-away"><span>${teamCode(replay.match.participant2.name)}</span><strong>${team2}</strong></div></div>
    <div class="ticket-action"><span class="eyebrow">${t.ready}</span><button class="primary" id="open-replay">${t.openReplay}<span aria-hidden="true">↗</span></button></div>
  </section>
  ${replay.source.mode === "synthetic" ? `<button class="text-button" id="back-real">${t.backReal}</button>` : ""}
  </main>`;
}

function controls(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  const durationClock = formatClock(replay.playbackDurationMs);
  const durationSeconds = Math.round(replay.playbackDurationMs / 1000);
  const playLabel = state.playing
    ? t.pause
    : state.playheadMs >= replay.playbackDurationMs
      ? t.restart
      : state.playheadMs > 0
        ? t.resume
        : t.play;
  return `<section class="replay-controls" aria-label="${t.replayControls}">
    <div class="hud-meta"><span>${t.matchNumber} / ${durationSeconds} ${t.secondsShort}</span><strong>${String(progress).padStart(2, "0")}%</strong></div>
    <div class="control-row">
      <button class="play" id="play" aria-pressed="${state.playing}"><span aria-hidden="true">${state.playing ? "Ⅱ" : "▶"}</span> ${playLabel}</button>
    <div class="clock" id="clock" aria-live="off">${formatClock(state.playheadMs)} <span>/ ${durationClock}</span></div>
    </div>
    <label class="scrubber"><span class="sr-only">${t.replayPosition}</span><input id="scrub" type="range" min="0" max="${replay.playbackDurationMs}" step="100" value="${Math.round(state.playheadMs)}" aria-valuetext="${progress}%" /></label>
    <button class="reveal" id="reveal-all">${t.revealAll}</button>
  </section>`;
}

function eventLabel(event: ReplayEvent): string {
  const t = copy(state.lang);
  const known = t.actions[event.action as keyof typeof t.actions];
  return known ?? t.unknownEvent;
}

function scoreboard(replay: ReplayEnvelope): string {
  if (state.playheadMs <= 0) return "";
  const score = scoreAt(replay.events, state.playheadMs);
  if (!score || score.participant1 === null || score.participant2 === null) return "";
  const t = copy(state.lang);
  return `<section class="score-card" data-testid="score-card"><div class="score-kicker"><span>${t.score}</span><i>${t.liveAtPlayhead}</i></div><div class="score-grid"><div><small>${teamCode(replay.match.participant1.name)}</small><strong>${escapeHtml(replay.match.participant1.name)}</strong></div><b><span>${score.participant1}</span> <i>—</i> <span>${score.participant2}</span></b><div><small>${teamCode(replay.match.participant2.name)}</small><strong>${escapeHtml(replay.match.participant2.name)}</strong></div></div></section>`;
}

function timeline(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const events = visibleAt(replay.events, state.playheadMs);
  const rows = events.map((event) => `<li data-seq="${event.seq}">
    <time>${minuteLabel(event.minute)}</time>
    <div><strong>${escapeHtml(eventLabel(event))}</strong>${event.participantName ? `<span>${escapeHtml(event.participantName)}</span>` : ""}${event.corrected ? `<em>${t.corrected}</em>` : ""}</div>
  </li>`).join("");
  return `<section class="panel timeline-panel"><header class="section-head"><span>02 / ${t.eventFeed}</span><h2>${t.timeline}</h2></header><ol data-testid="timeline">${rows || `<li class="empty">${t.noEvents}</li>`}</ol></section>`;
}

function turningPoint(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const point = replay.turningPoint;
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  if (!point) return atEnd ? `<section class="panel honest-empty" data-testid="no-moment"><h2>${t.moment}</h2><p>${t.noMoment}</p></section>` : "";
  if (state.playheadMs < point.playbackMs) return "";
  const movement = point.movement;
  const sentence = t.coincided
    .replace("{minute}", minuteLabel(point.minute))
    .replace("{event}", escapeHtml(eventLabel({ action: point.action } as ReplayEvent)).toLowerCase())
    .replace("{before}", movement.before.pct.toFixed(1))
    .replace("{after}", movement.after.pct.toFixed(1))
    .replace("{price}", escapeHtml(movement.tuple.priceName));
  const tuple = [movement.tuple.bookmakerId, movement.tuple.superOddsType, movement.tuple.marketPeriod, movement.tuple.marketParameters, movement.tuple.priceName]
    .map((value) => escapeHtml(value ?? "∅"))
    .join(" · ");
  const momentScore = scoreAt(replay.events, point.playbackMs);
  const momentMinute = minuteLabel(point.minute);
  const momentScoreMarkup = momentScore && momentScore.participant1 !== null && momentScore.participant2 !== null
    ? `<div class="moment-score"><em class="moment-score-label">${t.momentScoreAt.replace("{minute}", momentMinute)}</em><span><b>${teamCode(replay.match.participant1.name)}</b><small>${escapeHtml(replay.match.participant1.name)}</small></span><strong>${momentScore.participant1} — ${momentScore.participant2}</strong><span class="away"><b>${teamCode(replay.match.participant2.name)}</b><small>${escapeHtml(replay.match.participant2.name)}</small></span></div>`
    : "";
  return `<section class="turning-point${state.justAutoPaused ? " auto-paused" : ""}" data-testid="turning-point">
    <div class="moment-rings" aria-hidden="true"></div><div class="moment-top"><span class="eyebrow">01 / ${t.moment}</span><strong>${momentMinute}</strong></div><h2>${state.justAutoPaused ? t.autoPaused : t.moment}</h2>
    ${momentScoreMarkup}
    <svg class="signal-wave" viewBox="0 0 640 120" preserveAspectRatio="none" aria-hidden="true"><path class="signal-grid" d="M0 30H640M0 60H640M0 90H640"/><path class="signal-guide" d="M64 86V110M576 20V110"/><path class="signal-line" d="M64 86L576 20"/><circle class="signal-before" cx="64" cy="86" r="8"/><circle class="signal-after" cx="576" cy="20" r="10"/></svg>
    <div class="movement"><span><small>${t.before}</small><b>${movement.before.pct.toFixed(1)}<sup>%</sup></b></span><i aria-hidden="true">→</i><strong><small>${t.after}</small><b>${movement.after.pct.toFixed(1)}<sup>%</sup></b></strong></div>
    <p>${sentence}</p><details><summary>${t.tuple}<span aria-hidden="true">＋</span></summary><code>${tuple}</code></details><small>${t.nonCausal}</small>
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
  if (state.playheadMs < pointAt) return "";
  const t = copy(state.lang);
  const [title, detail] = t.proof[replay.provenance.state];
  const endpoints = replay.source.endpoints.map((endpoint) => `<li><code>${endpointName(endpoint)}</code><span class="http ${endpoint.status >= 200 && endpoint.status < 300 ? "ok" : "bad"}">${endpoint.status || t.requestErrorShort}</span></li>`).join("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const pda = replay.provenance.dailyScoresPda;
  const explorerUrl = pda && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pda)
    ? `https://explorer.solana.com/address/${pda}?cluster=devnet`
    : null;
  return `<section class="panel provenance" data-testid="provenance">
    <header class="section-head"><span>03 / ${t.trustLayer}</span><h2>${t.provenance}</h2></header><div class="proof-badge ${replay.provenance.state}" data-proof-state="${replay.provenance.state}"><span></span><strong>${title}</strong></div><p>${detail}</p>
    ${replay.source.mode === "real_txline" ? `<dl><div><dt>${t.programLabel}</dt><dd><code>${escapeHtml(replay.provenance.programId)}</code></dd></div><div><dt>${t.sequenceStatsLabel}</dt><dd><code>${replay.provenance.seq ?? "—"} / ${replay.provenance.statKeys.join(",")}</code></dd></div><div><dt>${t.epochDayLabel}</dt><dd><code>${replay.provenance.epochDay ?? "—"}</code></dd></div><div><dt>${t.dailyScoresPdaLabel}</dt><dd><code>${escapeHtml(pda ?? "—")}</code></dd></div><div><dt>${t.proofTargetLabel}</dt><dd>${formattedTimestamp(replay.provenance.proofTargetTs, timeZone)}</dd></div><div><dt>${t.checkedAtLabel}</dt><dd>${formattedTimestamp(replay.provenance.checkedAt, timeZone)}</dd></div></dl>${explorerUrl ? `<a class="explorer-link" data-testid="proof-explorer" href="${explorerUrl}" target="_blank" rel="noreferrer noopener">${t.explorerLink}</a>` : ""}<p class="simulation-note">${t.readOnlySimulation}</p><h3>${t.endpointEvidence}</h3><ul class="endpoints" data-testid="endpoints">${endpoints}</ul>` : ""}
    <small>${t.rawOmitted}</small>
  </section>`;
}

function replayView(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  return `<main class="replay-page">${sourceBanner(replay)}<section class="replay-head"><button class="back-to-picker" id="back-to-picker"><span aria-hidden="true">←</span> ${t.backToMatch}</button><div class="replay-title"><span class="eyebrow">${t.safe}</span><h1>${escapeHtml(replay.match.participant1.name)} <span>×</span> ${escapeHtml(replay.match.participant2.name)}</h1><p>${t.safeHint}</p></div><div class="match-codes" aria-hidden="true"><span>${teamCode(replay.match.participant1.name)}</span><i>/</i><span>${teamCode(replay.match.participant2.name)}</span></div></section>
    <div class="replay-stage"><aside class="replay-console">${controls(replay)}${scoreboard(replay)}<div class="console-note"><i></i><span>${t.normalizedNoStore}</span></div></aside><div class="replay-feed">${turningPoint(replay)}${timeline(replay)}${provenance(replay)}</div></div>
  </main>`;
}

function render(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  const focusedId = document.activeElement instanceof HTMLElement && app.contains(document.activeElement)
    ? document.activeElement.id
    : "";
  document.documentElement.lang = state.lang;
  updateDocumentMetadata();
  document.body.dataset.view = state.view;
  document.body.dataset.source = state.replay?.source.mode ?? "pending";
  let body = loading();
  if (state.view === "error") body = errorView();
  else if (state.view === "picker" && state.replay) body = picker(state.replay);
  else if (state.view === "replay" && state.replay) body = replayView(state.replay);
  app.innerHTML = `${header()}${body}<div id="announcer" class="sr-only" aria-live="polite">${state.justAutoPaused ? copy(state.lang).autoPaused : ""}</div>`;
  bind();
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  if (state.justAutoPaused) {
    window.requestAnimationFrame(() => {
      app.querySelector<HTMLElement>('[data-testid="turning-point"]')?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }
}

function bind(): void {
  document.querySelector("#lang")?.addEventListener("click", () => {
    state.lang = state.lang === "pt-BR" ? "en" : "pt-BR";
    render();
  });
  document.querySelector("#retry")?.addEventListener("click", () => void requestReplay(`/api/replays/${FROZEN_FIXTURE_ID}`));
  document.querySelector("#fictional")?.addEventListener("click", () => void requestReplay("/api/demo"));
  document.querySelector("#back-real")?.addEventListener("click", () => void requestReplay(`/api/replays/${FROZEN_FIXTURE_ID}`));
  document.querySelector("#open-replay")?.addEventListener("click", () => {
    state.playheadMs = 0;
    state.autoPauseHandled = false;
    navigateTo("replay");
  });
  document.querySelector("#back-to-picker")?.addEventListener("click", () => navigateTo("picker"));
  document.querySelector("#play")?.addEventListener("click", () => {
    if (!state.replay) return;
    state.justAutoPaused = false;
    if (state.playheadMs >= state.replay.playbackDurationMs) {
      state.playheadMs = 0;
      state.autoPauseHandled = false;
    }
    state.playing = !state.playing;
    if (state.playing) startTimer();
    else stopTimer();
    render();
  });
  const scrub = document.querySelector<HTMLInputElement>("#scrub");
  scrub?.addEventListener("input", (event) => {
    stopTimer();
    state.playing = false;
    state.justAutoPaused = false;
    state.playheadMs = Number((event.currentTarget as HTMLInputElement).value);
    if (state.replay?.turningPoint && state.playheadMs >= state.replay.turningPoint.playbackMs) state.autoPauseHandled = true;
    const clock = document.querySelector<HTMLElement>("#clock");
    if (clock && state.replay) clock.innerHTML = `${formatClock(state.playheadMs)} <span>/ ${formatClock(state.replay.playbackDurationMs)}</span>`;
  });
  scrub?.addEventListener("change", () => {
    render();
  });
  document.querySelector("#reveal-all")?.addEventListener("click", () => {
    if (!state.replay) return;
    stopTimer();
    state.playing = false;
    state.justAutoPaused = false;
    state.autoPauseHandled = true;
    state.playheadMs = state.replay.playbackDurationMs;
    render();
  });
}

const initialHistoryState = window.history.state && typeof window.history.state === "object"
  ? window.history.state as Record<string, unknown>
  : {};
window.history.replaceState({ ...initialHistoryState, torcidaView: viewFromLocation() }, "", window.location.href);
window.addEventListener("popstate", () => {
  if (state.replay) navigateTo(viewFromLocation(), false);
});

void requestReplay(`/api/replays/${FROZEN_FIXTURE_ID}`);
