import "./styles.css";
import { copy, type Lang } from "./i18n";
import { ACTIVE_REPLAY_FIXTURE_ID } from "./replay-contract";
import { formatInTz, minuteLabel } from "./time";
import { scoreAt, visibleAt } from "./timeline";
import { computeMarketPosition, fanRead, insightFanRead } from "./fan";
import type { EndpointEvidence, ReplayEnvelope, ReplayEvent, Team } from "./types";

type View = "loading" | "error" | "picker" | "replay";
type Surface = "live" | "moments" | "collection" | "proof";
type CommerceView = "closed" | "pricing" | "preview" | "minting" | "success" | "error";
type CollectedCard = {
  network: "devnet";
  standard: "Metaplex Core";
  assetAddress: string;
  ownerAddress: string;
  signature: string;
  explorerAssetUrl: string;
  explorerTransactionUrl: string;
};
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
  surface: Surface;
  lastCelebratedSeq: number;
  soundEnabled: boolean;
  commerceView: CommerceView;
  mintedCard: CollectedCard | null;
};

const SOUND_STORAGE_KEY = "torcida-pulse:sound-enabled";

function initialSoundEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    if (stored === null) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

function ensureAudio(): void {
  // Browsers lazily create AudioContext only after a user gesture; this is a
  // no-op until one happens (e.g. opening a replay or toggling sound).
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return;
  let ctx = (ensureAudio as unknown as { ctx?: AudioContext }).ctx;
  if (!ctx) {
    ctx = new Ctor();
    (ensureAudio as unknown as { ctx?: AudioContext }).ctx = ctx;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function playGoalSound(): void {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    let ctx = (ensureAudio as unknown as { ctx?: AudioContext }).ctx;
    if (!ctx) {
      ctx = new Ctor();
      (ensureAudio as unknown as { ctx?: AudioContext }).ctx = ctx;
    }
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    });
  } catch {
    /* audio is a nicety; ignore failures */
  }
}

function celebrateGoal(seq: number): void {
  if (!state.soundEnabled) return;
  if (state.lastCelebratedSeq === seq) return;
  state.lastCelebratedSeq = seq;
  ensureAudio();
  playGoalSound();
}

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
  surface: "live",
  lastCelebratedSeq: 0,
  soundEnabled: initialSoundEnabled(),
  commerceView: "closed",
  mintedCard: null,
};

let timer: number | null = null;
let playbackFrame: number | null = null;
let replayRequestSerial = 0;
let toastTimer: number | null = null;
const JUDGE_ACCESS_STORAGE_KEY = "torcida-pulse:judge-access";
const MOMENT_MEMORY_STORAGE_KEY = "torcida-pulse:saved-moments";
const COLLECTION_STORAGE_KEY = "torcida-pulse:legendary-91-collected";
const CLAIM_KEY_STORAGE_KEY = "torcida-pulse:legendary-91-claim-key";
const LEGENDARY_CARD_SRC = "/legendary-turning-point.webp";

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

type TeamVisual = {
  code?: string;
  aliases: string[];
  primary: string;
  secondary: string;
  ink: "#07100b" | "#ffffff";
};

const KNOWN_TEAM_VISUALS: TeamVisual[] = [
  { code: "BRA", aliases: ["brazil", "brasil"], primary: "#ffdf00", secondary: "#009c3b", ink: "#07100b" },
  { code: "ARG", aliases: ["argentina"], primary: "#74acdf", secondary: "#ffffff", ink: "#07100b" },
  { code: "FRA", aliases: ["france", "franca"], primary: "#15317e", secondary: "#ef4135", ink: "#ffffff" },
  { code: "GER", aliases: ["germany", "alemanha", "deutschland"], primary: "#f5f5f5", secondary: "#161616", ink: "#07100b" },
  { code: "ESP", aliases: ["spain", "espanha", "espana"], primary: "#c60b1e", secondary: "#ffc400", ink: "#ffffff" },
  { code: "POR", aliases: ["portugal"], primary: "#a71930", secondary: "#046a38", ink: "#ffffff" },
  { code: "ENG", aliases: ["england", "inglaterra"], primary: "#f2f2f2", secondary: "#cf081f", ink: "#07100b" },
  { code: "NED", aliases: ["netherlands", "holanda", "paises baixos"], primary: "#f36c21", secondary: "#1b2a5b", ink: "#07100b" },
  { code: "ITA", aliases: ["italy", "italia"], primary: "#0066b3", secondary: "#ffffff", ink: "#ffffff" },
  { code: "BEL", aliases: ["belgium", "belgica"], primary: "#e30613", secondary: "#ffd90c", ink: "#ffffff" },
  { code: "CRO", aliases: ["croatia", "croacia"], primary: "#e31b23", secondary: "#17408b", ink: "#ffffff" },
  { code: "URU", aliases: ["uruguay", "uruguai"], primary: "#7cc7ef", secondary: "#111111", ink: "#07100b" },
  { code: "COL", aliases: ["colombia"], primary: "#fcd116", secondary: "#003893", ink: "#07100b" },
  { code: "MEX", aliases: ["mexico"], primary: "#006847", secondary: "#ce1126", ink: "#ffffff" },
  { code: "USA", aliases: ["united states", "estados unidos", "usa"], primary: "#1b365d", secondary: "#c8102e", ink: "#ffffff" },
  { code: "CAN", aliases: ["canada"], primary: "#d80621", secondary: "#ffffff", ink: "#ffffff" },
  { code: "JPN", aliases: ["japan", "japao"], primary: "#1b3f8b", secondary: "#e6002d", ink: "#ffffff" },
  { code: "KOR", aliases: ["south korea", "coreia do sul", "korea republic"], primary: "#e8293f", secondary: "#173f8a", ink: "#ffffff" },
  { code: "MAR", aliases: ["morocco", "marrocos"], primary: "#c1272d", secondary: "#006233", ink: "#ffffff" },
  { code: "SEN", aliases: ["senegal"], primary: "#00853f", secondary: "#fdef42", ink: "#ffffff" },
  { code: "GHA", aliases: ["ghana"], primary: "#ce1126", secondary: "#fcd116", ink: "#ffffff" },
  { code: "NGA", aliases: ["nigeria"], primary: "#008751", secondary: "#ffffff", ink: "#ffffff" },
  { code: "AUS", aliases: ["australia"], primary: "#ffcd00", secondary: "#00843d", ink: "#07100b" },
  { code: "ECU", aliases: ["ecuador"], primary: "#ffdd00", secondary: "#034ea2", ink: "#07100b" },
  { code: "CHI", aliases: ["chile"], primary: "#d52b1e", secondary: "#0039a6", ink: "#ffffff" },
  { code: "PER", aliases: ["peru"], primary: "#d91023", secondary: "#ffffff", ink: "#ffffff" },
  { code: "SUI", aliases: ["switzerland", "suica"], primary: "#d52b1e", secondary: "#ffffff", ink: "#ffffff" },
  { code: "DEN", aliases: ["denmark", "dinamarca"], primary: "#c60c30", secondary: "#ffffff", ink: "#ffffff" },
  { code: "POL", aliases: ["poland", "polonia"], primary: "#dc143c", secondary: "#ffffff", ink: "#ffffff" },
  { code: "SRB", aliases: ["serbia", "servia"], primary: "#c6363c", secondary: "#0c4076", ink: "#ffffff" },
  { code: "UKR", aliases: ["ukraine", "ucrania"], primary: "#0057b7", secondary: "#ffd700", ink: "#ffffff" },
  { aliases: ["azul teste"], primary: "#3157ff", secondary: "#89a2ff", ink: "#ffffff" },
  { aliases: ["dourado teste"], primary: "#ffc857", secondary: "#8b5e00", ink: "#07100b" },
  { aliases: ["aurora fc"], primary: "#c7adff", secondary: "#ff5976", ink: "#07100b" },
  { aliases: ["vento sul"], primary: "#31c5d9", secondary: "#3157ff", ink: "#07100b" },
];

const FALLBACK_TEAM_VISUALS: Array<Pick<TeamVisual, "primary" | "secondary" | "ink">> = [
  { primary: "#3157ff", secondary: "#89a2ff", ink: "#ffffff" },
  { primary: "#ff5976", secondary: "#ffc0cb", ink: "#07100b" },
  { primary: "#ffc857", secondary: "#8b5e00", ink: "#07100b" },
  { primary: "#25b67a", secondary: "#8ff0c2", ink: "#07100b" },
  { primary: "#c7adff", secondary: "#7048c8", ink: "#07100b" },
  { primary: "#f2762e", secondary: "#ffd0a8", ink: "#07100b" },
];

function normalizedTeamName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function teamVisual(team: Pick<Team, "id" | "name">): Pick<TeamVisual, "primary" | "secondary" | "ink"> & { code?: string } {
  const lookup = `${normalizedTeamName(team.name)} ${normalizedTeamName(team.id)}`;
  const paddedLookup = ` ${lookup} `;
  const known = KNOWN_TEAM_VISUALS.find((visual) => visual.aliases.some((alias) => paddedLookup.includes(` ${alias} `)));
  if (known) return known;
  let hash = 0;
  for (const character of lookup) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return FALLBACK_TEAM_VISUALS[Math.abs(hash) % FALLBACK_TEAM_VISUALS.length];
}

function teamClass(team: Pick<Team, "id" | "name">): string {
  const lookup = `${normalizedTeamName(team.name)} ${normalizedTeamName(team.id)}`;
  const paddedLookup = ` ${lookup} `;
  const knownIndex = KNOWN_TEAM_VISUALS.findIndex((visual) => visual.aliases.some((alias) => paddedLookup.includes(` ${alias} `)));
  if (knownIndex >= 0) {
    const visual = KNOWN_TEAM_VISUALS[knownIndex];
    const slug = visual.code?.toLowerCase() ?? visual.aliases[0].replace(/\s+/g, "-");
    return `team-theme-${slug}`;
  }
  let hash = 0;
  for (const character of lookup) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `team-theme-fallback-${Math.abs(hash) % FALLBACK_TEAM_VISUALS.length}`;
}

function teamRibbon(replay: ReplayEnvelope): string {
  return `<div class="team-ribbon" aria-hidden="true"><i class="${teamClass(replay.match.participant1)}"></i><i class="${teamClass(replay.match.participant2)}"></i></div>`;
}

function teamCode(name: string): string {
  const knownCode = teamVisual({ id: "", name }).code;
  if (knownCode) return knownCode;
  const code = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").slice(0, 3);
  return code ? code.toUpperCase() : "—";
}

function teamForEvent(replay: ReplayEnvelope, event: Pick<ReplayEvent, "participantId" | "participantName">): Team | null {
  const teams = [replay.match.participant1, replay.match.participant2];
  return teams.find((team) =>
    (event.participantId !== null && team.id === event.participantId) ||
    (event.participantName !== null && normalizedTeamName(team.name) === normalizedTeamName(event.participantName))
  ) ?? null;
}

function isMomentSaved(_replay: ReplayEnvelope): boolean {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MOMENT_MEMORY_STORAGE_KEY) ?? "null") as unknown;
    return typeof stored === "object" && stored !== null && "saved" in stored && stored.saved === true;
  } catch {
    return false;
  }
}

function toggleMomentLocally(replay: ReplayEnvelope): void {
  try {
    if (isMomentSaved(replay)) {
      window.localStorage.removeItem(MOMENT_MEMORY_STORAGE_KEY);
      return;
    }
    // Persist only the fan's preference and time. No TxLINE field or proof data is stored.
    window.localStorage.setItem(MOMENT_MEMORY_STORAGE_KEY, JSON.stringify({
      saved: true,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage may be disabled. The UI stays truthful by checking persistence after the write.
  }
}

function legendaryCard(): CollectedCard | null {
  if (state.mintedCard) return state.mintedCard;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLECTION_STORAGE_KEY) ?? "null") as unknown;
    return isCollectedCard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCollectedCard(value: unknown): value is CollectedCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<CollectedCard>;
  return card.network === "devnet" && card.standard === "Metaplex Core" &&
    typeof card.assetAddress === "string" && typeof card.ownerAddress === "string" &&
    typeof card.signature === "string" && typeof card.explorerAssetUrl === "string" &&
    typeof card.explorerTransactionUrl === "string" &&
    /^https:\/\/explorer\.solana\.com\/(?:address|tx)\//.test(card.explorerAssetUrl) &&
    /^https:\/\/explorer\.solana\.com\/(?:address|tx)\//.test(card.explorerTransactionUrl);
}

function collectibleClaimKey(): string {
  try {
    const existing = window.localStorage.getItem(CLAIM_KEY_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(CLAIM_KEY_STORAGE_KEY, key);
    return key;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}claim`;
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
      schedulePlaybackDomUpdate();
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
  stopTimer();
  state.view = "loading";
  state.errorCode = null;
  state.replay = null;
  render();
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
    if (!response.ok || !("schemaVersion" in body) || body.source.mode !== "real_txline") {
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
  }
  if (requestSerial !== replayRequestSerial) return;
  render();
}

function header(): string {
  const t = copy(state.lang);
  const offline = state.view === "error";
  const status = offline ? t.txlineOffline : t.txlineStatus;
  return `<header class="app-header">
    <div class="brand-lockup"><div class="brand-sigil" aria-hidden="true"><b>P</b><i></i></div><div><div class="wordmark">Torcida <span>Pulse</span></div><p>${t.subtitle}</p></div></div>
    <div class="header-actions"><span class="system-status${offline ? " offline" : ""}"><i></i> ${status}</span><button id="lang" class="icon-button" aria-label="${t.changeLanguage}">${t.lang}</button></div>
  </header>`;
}

function loading(): string {
  const t = copy(state.lang);
  return `<main class="loading-view"><section class="loading-promise">
    <span class="eyebrow">${t.loadingEyebrow}</span><h1>${t.promise} <em>${t.promiseAccent}</em></h1>
    <p role="status"><span class="loading-dot" aria-hidden="true"></span>${t.loading}</p>
  </section><section class="loading-match" data-testid="loading-match">
    <div><span>${t.loadingMatch}</span><strong>${t.loadingFixture} · ${ACTIVE_REPLAY_FIXTURE_ID}</strong></div>
    <div class="loading-score" aria-hidden="true"><i></i><b>— : —</b><i></i></div>
    <button class="primary" disabled>${t.loadingCta}</button>
  </section></main>`;
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
    ? `<div class="judge-gate"><strong>${t.judgeEntry}</strong><form id="judge-access-form" class="judge-access-form"><label for="judge-access">${t.judgeCode}</label><input id="judge-access" name="judge-access" type="password" required minlength="16" autocomplete="off" placeholder="${t.judgeCodePlaceholder}" /><button type="submit">${t.judgeCodeSubmit}</button></form></div>`
    : "";
  return `<main><section class="hero error-panel" role="alert" aria-labelledby="error-title">
    <span class="eyebrow">${t.txlineOffline}</span><h1 id="error-title">${t.loadFailed}</h1><p>${detail}</p>
    <code class="error-code">${escapeHtml(state.errorCode)}</code>
    ${judgeAccess}<div class="button-stack"><button class="primary" id="retry">${t.retry}</button></div>
  </section></main>`;
}

function sourceBanner(): string {
  const t = copy(state.lang);
  return `<div class="source-banner real" data-testid="source-banner"><span><i></i>${t.realSource}</span><b>${t.serverSideNoStore}</b></div>`;
}

function picker(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const team1 = escapeHtml(replay.match.participant1.name);
  const team2 = escapeHtml(replay.match.participant2.name);
  const durationSeconds = Math.round(replay.playbackDurationMs / 1000);
  const promiseDetail = t.promiseDetail.replace("{seconds}", String(durationSeconds));
  const catchUpResponsive = t.catchUpResponsive.replace("{seconds}", String(durationSeconds));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const startDateTime = new Date(replay.match.startTime).toISOString();
  const startLabel = formatInTz(replay.match.startTime, timeZone);
  const saved = isMomentSaved(replay);
  return `<main class="picker-page">${sourceBanner()}<section class="hero picker-hero">
    <div class="hero-copy"><span class="eyebrow hero-eyebrow"><i aria-hidden="true"></i>${t.heroEyebrow}</span><h1><span>${t.promise}</span><em>${t.promiseAccent}</em></h1><p>${promiseDetail}</p>
      <ul class="catch-up-proof" aria-label="${t.heroEyebrow}"><li><b>✦</b>${t.catchUpFast}</li><li><b>◆</b>${t.catchUpSafe}</li><li><b>↗</b>${catchUpResponsive}</li></ul>
    </div>
    <div class="reward-orbit" aria-hidden="true"><i></i><i></i><div class="reward-card-back"><span>DROP</span><b>?</b><small>NFT</small></div></div>
  </section>
  <section class="match-card" data-testid="match-card">${teamRibbon(replay)}
    <div class="ticket-meta"><span>${t.matchNumber}</span><time data-testid="match-start" datetime="${startDateTime}" data-timezone="${escapeHtml(timeZone)}">${escapeHtml(startLabel)}</time><span>${escapeHtml(replay.match.competition ?? "")}</span></div>
    <div class="demo-disclosure"><span><i aria-hidden="true"></i>${t.endedDemo}</span><b>${t.matchDropStatus}</b></div>
    <div class="match-up"><div class="team ${teamClass(replay.match.participant1)}"><span>${teamCode(replay.match.participant1.name)}</span><strong>${team1}</strong></div><div class="locked-score"><i aria-hidden="true">◉</i><b>— : —</b><small>${t.scoreLocked}</small></div><div class="team team-away ${teamClass(replay.match.participant2)}"><span>${teamCode(replay.match.participant2.name)}</span><strong>${team2}</strong></div></div>
    <div class="match-drop"><div class="drop-token" aria-hidden="true">✦</div><div><span class="eyebrow">${t.matchDropLabel}</span><strong>${t.matchDropTitle}</strong></div><b><i aria-hidden="true"></i>${t.matchDropStatus}</b></div>
    <div class="ticket-action"><div><span class="eyebrow">${saved ? `✓ ${t.momentSaved}` : t.ready}</span><strong>${durationSeconds}s</strong></div><button class="primary" id="open-replay">${t.openReplay}<span aria-hidden="true">▶</span></button></div>
  </section>
  <section class="product-flow" aria-label="${t.productFlowLabel}"><span class="eyebrow">${t.productFlowLabel}</span><ol>
    <li><b>01</b><div><strong>${t.productFlowLiveTitle}</strong><p>${t.productFlowLiveDetail}</p></div></li>
    <li><b>02</b><div><strong>${t.productFlowDropTitle}</strong><p>${t.productFlowDropDetail}</p></div></li>
    <li><b>03</b><div><strong>${t.productFlowKeepTitle}</strong><p>${t.productFlowKeepDetail}</p></div></li>
  </ol></section>
  </main>`;
}

function controls(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  const statusLabel = atEnd ? t.replayComplete : t.replayStatus;
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  const durationClock = formatClock(replay.playbackDurationMs);
  const currentPlayLabel = state.playing
    ? t.pause
    : state.playheadMs >= replay.playbackDurationMs
      ? t.restart
      : state.playheadMs > 0
        ? t.resume
        : t.play;
  return `<section class="replay-controls${state.justAutoPaused ? " is-auto-paused" : ""}" aria-label="${t.replayControls}">
    <div class="hud-meta"><span id="hud-status">${statusLabel}</span><strong id="progress">${String(progress).padStart(2, "0")}%</strong></div>
    <div class="control-row">
      <button class="play" id="play" aria-pressed="${state.playing}"><span id="play-icon" aria-hidden="true">${state.playing ? "Ⅱ" : "▶"}</span><span id="play-label">${currentPlayLabel}</span></button>
    <div class="clock" id="clock" aria-live="off"><span id="clock-current">${formatClock(state.playheadMs)}</span> <span>/ ${durationClock}</span></div>
    </div>
    <label class="scrubber"><span class="sr-only">${t.replayPosition}</span><input id="scrub" type="range" min="0" max="${replay.playbackDurationMs}" step="100" value="${Math.round(state.playheadMs)}" aria-valuetext="${progress}%" /></label>
    ${atEnd ? "" : `<div class="replay-shortcuts">${replay.turningPoint ? `<button class="reveal jump-moment" id="jump-moment">${t.jumpMoment}</button>` : ""}<button class="reveal" id="reveal-all">${t.revealAll}</button></div>`}
  </section>`;
}

function eventLabel(event: ReplayEvent): string {
  const t = copy(state.lang);
  const known = t.actions[event.action as keyof typeof t.actions];
  return known ?? t.unknownEvent;
}

function scoreboard(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const statusLabel = state.playheadMs >= replay.playbackDurationMs ? t.replayComplete : t.replayStatus;
  const score = state.playheadMs > 0 ? scoreAt(replay.events, state.playheadMs) : null;
  const available = Boolean(score && score.participant1 !== null && score.participant2 !== null);
  const scoreMarkup = available ? `${score?.participant1} <i>—</i> ${score?.participant2}` : `<span aria-hidden="true">—</span> <i>:</i> <span aria-hidden="true">—</span><small>${t.hiddenScore}</small>`;
  const visibleEvents = visibleAt(replay.events, state.playheadMs);
  const latest = visibleEvents[visibleEvents.length - 1];
  const celebrating = Boolean(
    latest &&
    latest.action.toLowerCase() === "goal" &&
    latest.seq !== replay.turningPoint?.eventSeq &&
    state.playheadMs - latest.playbackMs < 500
  );
  const scoringTeam = latest ? teamForEvent(replay, latest) : null;
  const celebration = celebrating && scoringTeam
    ? `<div class="goal-celebration" data-testid="goal-celebration" aria-hidden="true"><span>${teamCode(scoringTeam.name)}</span><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="sr-only" role="status">${escapeHtml(eventLabel(latest))} · ${escapeHtml(scoringTeam.name)}</span>`
    : "";
  return `<section class="score-card${available ? "" : " locked"}${celebrating ? " goal-scored" : ""}${scoringTeam ? ` ${teamClass(scoringTeam)}` : ""}" data-testid="score-card">${teamRibbon(replay)}${celebration}<div class="score-kicker"><span>${statusLabel}</span><i>${available ? t.liveAtPlayhead : t.safe}</i></div><div class="score-grid"><div class="score-team ${teamClass(replay.match.participant1)}"><small>${teamCode(replay.match.participant1.name)}</small><strong>${escapeHtml(replay.match.participant1.name)}</strong></div><b>${scoreMarkup}</b><div class="score-team ${teamClass(replay.match.participant2)}"><small>${teamCode(replay.match.participant2.name)}</small><strong>${escapeHtml(replay.match.participant2.name)}</strong></div></div>${momentumMarkup(replay)}</section>`;
}

function momentumMarkup(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const visibleEvents = visibleAt(replay.events, state.playheadMs);
  if (visibleEvents.length === 0 || !replay.turningPoint || state.playheadMs < replay.turningPoint.playbackMs) return "";
  const market = computeMarketPosition(
    replay.turningPoint,
    replay.match.participant1,
    replay.match.participant2,
    state.playheadMs,
  );
  if (!market) return "";
  const observed = market.observedTeam === 1 ? replay.match.participant1 : replay.match.participant2;
  const snapshotLabel = market.snapshot === "before" ? t.before : t.after;
  const label = `${teamCode(observed.name)} · ${market.observedPct.toFixed(1)}%`;
  const readLabel = t.momentumReadReal
    .replace("{team}", observed.name)
    .replace("{pct}", market.observedPct.toFixed(1))
    .replace("{snapshot}", snapshotLabel.toLocaleLowerCase(state.lang));
  return `<div class="momentum" data-testid="momentum" data-share1="${market.share1}" role="img" aria-label="${escapeHtml(readLabel)}">
    <div class="momentum-head"><span>${t.momentumTitle}</span><b>${escapeHtml(label)}</b></div>
    <div class="momentum-bar" aria-hidden="true"><span class="momentum-knob"></span></div>
    <div class="momentum-axis" aria-hidden="true"><small>${teamCode(replay.match.participant1.name)}</small><small>${teamCode(replay.match.participant2.name)}</small></div>
    <p class="momentum-read">${escapeHtml(readLabel)}</p>
  </div>`;
}

function livePulse(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const events = visibleAt(replay.events, state.playheadMs);
  const latest = events[events.length - 1];
  const point = replay.turningPoint;
  const pointVisible = Boolean(point && state.playheadMs >= point.playbackMs);
  const pulse = replay.goalPulses
    .filter((candidate) => candidate.playbackMs <= state.playheadMs)
    .sort((left, right) => left.playbackMs - right.playbackMs)
    .pop();
  const hasImpact = Boolean(pulse);
  const progress = Math.round((state.playheadMs / replay.playbackDurationMs) * 100);
  let movementMarkup = "";
  let pulseTeamClass = "";
  if (pulse) {
    const movement = pulse.movement;
    const delta = movement.direction === "up"
      ? movement.deltaPercentagePoints
      : -movement.deltaPercentagePoints;
    const formattedDelta = `${delta >= 0 ? "+" : ""}${new Intl.NumberFormat(state.lang, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(delta)}`;
    const movementTeam = teamForEvent(replay, { participantId: null, participantName: movement.tuple.priceName });
    pulseTeamClass = movementTeam ? ` ${teamClass(movementTeam)}` : "";
    const directionLabel = delta >= 0 ? t.pulseFor : t.pulseAgainst;
    const accessibleMovement = `${directionLabel} ${movement.tuple.priceName}: ${t.before} ${movement.before.pct.toFixed(1)}%, ${t.pulseNow} ${movement.after.pct.toFixed(1)}%, ${formattedDelta} pp.`;
    movementMarkup = `<div class="pulse-impact ${delta >= 0 ? "is-up" : "is-down"}" data-testid="pulse-movement" role="status" aria-live="polite" aria-atomic="true" aria-label="${escapeHtml(accessibleMovement)}">
      <div class="pulse-impact-head"><span><i aria-hidden="true">${delta >= 0 ? "↗" : "↘"}</i>${directionLabel}</span><strong title="${escapeHtml(movement.tuple.priceName)}">${escapeHtml(movement.tuple.priceName)}</strong><em>${formattedDelta} pp</em></div>
      <div class="pulse-impact-values" aria-hidden="true"><span><small>${t.before}</small><b>${movement.before.pct.toFixed(1)}%</b></span><i>→</i><strong><small>${t.pulseNow}</small><b>${movement.after.pct.toFixed(1)}%</b></strong></div>
    </div>`;
  }
  return `<section class="live-pulse${hasImpact ? " has-impact" : ""}${pulseTeamClass}" data-testid="live-pulse">
    <div class="pulse-visual" aria-hidden="true"><svg viewBox="0 0 100 100"><circle class="pulse-track" cx="50" cy="50" r="39"/><circle class="pulse-progress" cx="50" cy="50" r="39" pathLength="100" stroke-dasharray="${progress} 100"/></svg><i></i><b>P</b></div>
    <div class="pulse-copy"><span class="eyebrow">${t.signalPulse} · ${events.length} ${t.eventsRevealed}</span><h2>${pointVisible ? t.pulseShiftHeadline : hasImpact ? t.pulseGoalHeadline : t.pulseListening}</h2><p>${latest ? `<strong>${t.lastEvent}: ${minuteLabel(latest.minute)} · ${escapeHtml(eventLabel(latest))}</strong>` : t.pulseListeningDetail}</p>${movementMarkup || (latest ? `<p class="pulse-read">${escapeHtml(fanRead(latest.action, state.lang))}</p>` : "")}</div>
  </section>`;
}

function timeline(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const events = visibleAt(replay.events, state.playheadMs);
  const rows = events.map((event) => {
    const team = teamForEvent(replay, event);
    return `<li data-seq="${event.seq}" class="${team ? `team-event ${teamClass(team)}` : "match-event"}${event.action.toLowerCase() === "goal" ? " goal-event" : ""}">
    <time>${minuteLabel(event.minute)}</time>
    <div><strong>${escapeHtml(eventLabel(event))}</strong>${event.participantName ? `<span>${team ? `<b>${teamCode(team.name)}</b>` : ""}${escapeHtml(event.participantName)}</span>` : ""}${event.corrected ? `<em>${t.corrected}</em>` : ""}</div>
    <small class="event-read">${escapeHtml(fanRead(event.action, state.lang))}</small>
  </li>`;
  }).join("");
  return `<section class="panel timeline-panel"><header class="section-head"><span>${t.eventFeed}</span><h2>${t.timeline}</h2><small>${events.length} ${t.eventsRevealed}</small></header><ol data-testid="timeline">${rows || `<li class="empty">${t.noEvents}</li>`}</ol></section>`;
}

function turningPointNarrative(replay: ReplayEnvelope): string {
  const point = replay.turningPoint;
  if (!point) return copy(state.lang).socialDescription;
  const t = copy(state.lang);
  const delta = point.movement.after.pct - point.movement.before.pct;
  const formattedDelta = `${delta >= 0 ? "+" : ""}${new Intl.NumberFormat(state.lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(delta)}`;
  return t.coincided
    .replace("{minute}", minuteLabel(point.minute))
    .replace("{event}", eventLabel({ action: point.action } as ReplayEvent).toLowerCase())
    .replace("{participant}", point.participantName ?? point.movement.tuple.priceName)
    .replace("{before}", point.movement.before.pct.toFixed(1))
    .replace("{after}", point.movement.after.pct.toFixed(1))
    .replace("{price}", point.movement.tuple.priceName)
    .replace("{delta}", formattedDelta);
}

function legendaryDrop(): string {
  const t = copy(state.lang);
  return `<article class="legendary-drop is-locked" data-testid="legendary-drop">
    <div class="legendary-aura" aria-hidden="true"></div>
    <header><span>${t.legendaryRarity}</span><strong>${t.premiumOnly}</strong></header>
    <figure><img src="${LEGENDARY_CARD_SRC}" width="800" height="1200" alt="${escapeHtml(t.legendaryTitle)}" /><figcaption>${t.artworkExampleNote}</figcaption></figure>
    <div class="legendary-copy"><span class="onchain-chip">${t.legendaryRarity}</span><h3>${t.legendaryTitle}</h3><p>${t.legendaryDetail}</p><button class="legendary-cta" id="unlock-legendary">${t.unlockLegendary}<span aria-hidden="true">→</span></button><small>${t.checkoutDisclosure}</small></div>
  </article>`;
}

function collection(_replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const card = legendaryCard();
  const primary = card
    ? `<article class="owned-collectible" data-testid="owned-collectible"><div class="owned-card-frame"><img src="${LEGENDARY_CARD_SRC}" width="800" height="1200" alt="${escapeHtml(t.legendaryTitle)}" /><span>✓ ${t.collectionOwned}</span></div><div class="owned-meta"><span>${t.realOnchain}</span><h3>${t.legendaryTitle}</h3><p>${t.custodyNote}</p><div class="chain-proof"><code>${escapeHtml(card.assetAddress.slice(0, 8))}…${escapeHtml(card.assetAddress.slice(-8))}</code><a href="${escapeHtml(card.explorerTransactionUrl)}" target="_blank" rel="noreferrer noopener">${t.viewTransaction} ↗</a><a href="${escapeHtml(card.explorerAssetUrl)}" target="_blank" rel="noreferrer noopener">${t.viewAsset} ↗</a></div></div></article>`
    : `<article class="collection-empty"><div class="empty-card-preview"><img src="${LEGENDARY_CARD_SRC}" width="800" height="1200" alt="" /><span aria-hidden="true">◇</span></div><span class="eyebrow">0 / 1</span><h3>${t.collectionEmptyTitle}</h3><p>${t.collectionEmptyDetail}</p><button class="primary" id="collection-premium">${t.unlockLegendary}</button></article>`;
  return `<section class="collection-panel" data-testid="collection"><header class="collection-head"><div><span class="eyebrow">${card ? t.collectionCount : "0 / 1"}</span><h2>${t.collectionTitle}</h2><p>${t.collectionSubtitle}</p></div><b>${card ? "01" : "00"}</b></header>${primary}<section class="future-drops"><span class="eyebrow">${t.nextDrops}</span><h3>${t.nextDropsDetail}</h3><div><article class="future-card rare"><b>84′</b><strong>${t.rare}</strong><small>${t.undiscovered}</small></article><article class="future-card epic"><b>?′</b><strong>${t.epic}</strong><small>${t.undiscovered}</small></article><article class="future-card legendary"><b>?′</b><strong>${t.legendaryRarity.split("·")[0]}</strong><small>${t.undiscovered}</small></article></div></section><p class="nft-reality-note">${t.nftDemoNote}</p></section>`;
}

function commerceModal(): string {
  const t = copy(state.lang);
  if (state.commerceView === "closed") return "";
  if (state.commerceView === "preview") {
    return `<div class="commerce-backdrop" data-testid="legendary-preview-modal"><section class="commerce-modal legendary-preview-modal" role="dialog" aria-modal="true" aria-labelledby="legendary-preview-title"><button class="modal-close" id="close-commerce" aria-label="${t.closePricing}">×</button><span class="eyebrow">${t.legendaryPreview}</span><h2 id="legendary-preview-title">${t.legendaryTitle}</h2><img src="${LEGENDARY_CARD_SRC}" width="800" height="1200" alt="${escapeHtml(t.legendaryTitle)}" /><p>${t.artworkExampleNote}</p></section></div>`;
  }
  if (state.commerceView === "pricing") {
    return `<div class="commerce-backdrop" data-testid="pricing-modal"><section class="commerce-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-title"><button class="modal-close" id="close-commerce" aria-label="${t.closePricing}">×</button><span class="eyebrow">${t.pricingEyebrow}</span><h2 id="pricing-title">${t.pricingTitle}</h2><p>${t.pricingDetail}</p><article class="price-card"><div><strong>${t.premiumPlan}</strong><span><b>${t.premiumPrice}</b> ${t.premiumPeriod}</span></div><i>POPULAR</i><ul><li>✓ ${t.premiumBenefitOne}</li><li>✓ ${t.premiumBenefitTwo}</li><li>✓ ${t.premiumBenefitThree}</li></ul><p class="checkout-boundary">${t.paymentNotRun}</p><small>${t.checkoutDisclosure}</small></article></section></div>`;
  }
  if (state.commerceView === "minting") {
    return `<div class="commerce-backdrop" data-testid="minting-modal"><section class="commerce-modal minting-modal" role="dialog" aria-modal="true" aria-labelledby="minting-title"><div class="chain-loader" aria-hidden="true"><i></i><i></i><b>◇</b></div><span class="success-chip">✓ ${t.paymentSuccess}</span><h2 id="minting-title">${t.mintingTitle}</h2><p>${t.mintingDetail}</p><code>${t.paymentDemoReceipt}</code></section></div>`;
  }
  if (state.commerceView === "error") {
    return `<div class="commerce-backdrop" data-testid="mint-error-modal"><section class="commerce-modal" role="dialog" aria-modal="true" aria-labelledby="mint-error-title"><button class="modal-close" id="close-commerce" aria-label="${t.closePricing}">×</button><span class="eyebrow error-chip">SOLANA DEVNET</span><h2 id="mint-error-title">${t.mintFailed}</h2><p>${t.mintFailedDetail}</p><button class="primary wide" id="retry-mint">${t.retryMint}</button></section></div>`;
  }
  const card = legendaryCard();
  return `<div class="commerce-backdrop" data-testid="payment-success-modal"><section class="commerce-modal success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><div class="success-mark" aria-hidden="true">✓</div><span class="success-chip">${t.realOnchain}</span><h2 id="success-title">${t.paymentSuccess}</h2><p>${t.paymentSuccessDetail}</p><code>${t.paymentDemoReceipt}</code>${card ? `<a href="${escapeHtml(card.explorerTransactionUrl)}" target="_blank" rel="noreferrer noopener">${t.viewTransaction} ↗</a>` : ""}<button class="primary wide" id="open-collection">${t.openCollection}</button></section></div>`;
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
  const momentScore = scoreAt(replay.events, point.playbackMs);
  const momentMinute = minuteLabel(point.minute);
  const momentScoreMarkup = momentScore && momentScore.participant1 !== null && momentScore.participant2 !== null
    ? `<div class="moment-score"><em class="moment-score-label">${t.momentScoreAt.replace("{minute}", momentMinute)}</em><span class="${teamClass(replay.match.participant1)}"><b>${teamCode(replay.match.participant1.name)}</b><small>${escapeHtml(replay.match.participant1.name)}</small></span><strong>${momentScore.participant1} — ${momentScore.participant2}</strong><span class="away ${teamClass(replay.match.participant2)}"><b>${teamCode(replay.match.participant2.name)}</b><small>${escapeHtml(replay.match.participant2.name)}</small></span></div>`
    : "";
  const compactProof = t.proofCompact[replay.provenance.state];
  const proofSymbol = replay.provenance.state === "verified" ? "✓" : "○";
  const rarityReason = t.rarityReason
    .replace("{participant}", escapeHtml(point.participantName ?? movement.tuple.priceName))
    .replace("{delta}", formattedDelta);
  const pointTeam = teamForEvent(replay, {
    participantId: null,
    participantName: point.participantName,
  });
  return `<section class="turning-point${state.justAutoPaused ? " auto-paused" : ""}${pointTeam ? ` ${teamClass(pointTeam)}` : ""}" data-testid="turning-point">
    <div class="moment-burst" aria-hidden="true"><i></i><i></i><b>${momentMinute}</b></div><div class="moment-top"><span class="eyebrow">${t.moment}</span><strong>${momentMinute}</strong></div><h2>${t.momentHeadline}</h2>
    ${state.justAutoPaused ? `<p class="auto-pause-note">${t.autoPaused}</p>` : ""}
    ${momentScoreMarkup}<div class="signal-guide"><span aria-hidden="true">〽</span>${t.signalGuide}</div>
    <div class="movement"><span><small>${t.before}</small><b>${movement.before.pct.toFixed(1)}<sup>%</sup></b></span><i aria-hidden="true">→</i><strong><small>${t.after}</small><b>${movement.after.pct.toFixed(1)}<sup>%</sup></b></strong></div>
    <div class="rarity-callout"><span>${t.rarityLabel}</span><strong>${formattedDelta} pp</strong><p>${rarityReason}</p></div>
    <div class="moment-fan">${escapeHtml(insightFanRead(movement.direction, point.participantName ?? movement.tuple.priceName, state.lang))}</div>
    ${legendaryDrop()}
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
      <dl><div><dt>${t.programLabel}</dt><dd><code>${escapeHtml(replay.provenance.programId)}</code></dd></div><div><dt>${t.sequenceStatsLabel}</dt><dd><code>${replay.provenance.seq ?? "—"} / ${replay.provenance.statKeys.join(",")}</code></dd></div><div><dt>${t.epochDayLabel}</dt><dd><code>${replay.provenance.epochDay ?? "—"}</code></dd></div><div><dt>${t.dailyScoresPdaLabel}</dt><dd><code>${escapeHtml(pda ?? "—")}</code></dd></div><div><dt>${t.proofTargetLabel}</dt><dd>${formattedTimestamp(replay.provenance.proofTargetTs, timeZone)}</dd></div><div><dt>${t.checkedAtLabel}</dt><dd>${formattedTimestamp(replay.provenance.checkedAt, timeZone)}</dd></div></dl>${explorerUrl ? `<a class="explorer-link" data-testid="proof-explorer" href="${explorerUrl}" target="_blank" rel="noreferrer noopener">${t.explorerLink}</a>` : ""}<p class="simulation-note">${t.readOnlySimulation}</p><h3>${t.endpointEvidence}</h3><ul class="endpoints" data-testid="endpoints">${endpoints}</ul>
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
      <button class="save-moment${saved ? " saved" : ""}" id="save-moment" aria-pressed="${saved}">${saved ? `✓ ${t.removeMoment}` : t.saveMoment}</button><small class="save-local-note">${t.saveLocalNote}</small>
      <button class="view-legendary-card" id="view-legendary-card">${t.viewLegendaryCard}<span aria-hidden="true">↗</span></button>
    </div>
    <div class="memory-card" aria-label="${t.collectibleLabel}"><span>${t.collectibleLabel}</span><strong>${teamCode(replay.match.participant1.name)} <i>×</i> ${teamCode(replay.match.participant2.name)}</strong><b>${minute}</b><small>${t.collectibleConcept}</small></div>
  </section>`;
}

function scoreRenderKey(replay: ReplayEnvelope): string {
  const score = state.playheadMs > 0 ? scoreAt(replay.events, state.playheadMs) : null;
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  return `${state.lang}:${score?.participant1 ?? "x"}:${score?.participant2 ?? "x"}:${atEnd ? "final" : "active"}:${visibleAt(replay.events, state.playheadMs).length}`;
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

function collectionRenderKey(replay: ReplayEnvelope): string {
  const pointVisible = replay.turningPoint ? state.playheadMs >= replay.turningPoint.playbackMs : false;
  return `${state.lang}:${pointVisible ? 1 : 0}:${legendaryCard()?.signature ?? "empty"}`;
}

function updateReplayPhase(replay: ReplayEnvelope): void {
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  const atMoment = Boolean(replay.turningPoint && state.playheadMs >= replay.turningPoint.playbackMs);
  document.body.dataset.replayPhase = atEnd ? "final" : atMoment ? "moment" : "playing";
  document.body.dataset.autoPaused = state.justAutoPaused ? "true" : "false";
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

function updatePlaybackDom(): void {
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
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  const t = copy(state.lang);
  const hudStatus = document.querySelector<HTMLElement>("#hud-status");
  if (hudStatus) hudStatus.textContent = atEnd ? t.replayComplete : t.replayStatus;
  const replayStateLabel = document.querySelector<HTMLElement>("#replay-state-label");
  if (replayStateLabel) replayStateLabel.textContent = atEnd ? t.spoilersRevealed : t.safe;
  const replayStatusLabel = document.querySelector<HTMLElement>("#replay-status-label");
  if (replayStatusLabel) replayStatusLabel.textContent = atEnd ? t.replayComplete : t.replayStatus;
  const shortcuts = document.querySelector<HTMLElement>(".replay-shortcuts");
  if (shortcuts) shortcuts.hidden = atEnd;
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
    updateDynamicSlot("collection-slot", collectionRenderKey(replay), collection(replay)),
  ].some(Boolean);
  const visibleGoal = visibleAt(replay.events, state.playheadMs)
    .filter((event) => event.action.toLowerCase() === "goal" || event.action.toLowerCase() === "own_goal")
    .sort((a, b) => a.seq - b.seq)
    .pop();
  if (visibleGoal) celebrateGoal(visibleGoal.seq);
  if (dynamicChanged) bindDynamicControls();
  const announcer = document.querySelector<HTMLElement>("#announcer");
  if (announcer) announcer.textContent = state.justAutoPaused ? copy(state.lang).autoPaused : "";
}

function schedulePlaybackDomUpdate(): void {
  if (playbackFrame !== null) return;
  playbackFrame = window.requestAnimationFrame(() => {
    playbackFrame = null;
    updatePlaybackDom();
  });
}

function replayView(replay: ReplayEnvelope): string {
  const t = copy(state.lang);
  const atEnd = state.playheadMs >= replay.playbackDurationMs;
  const replayStateLabel = atEnd ? t.spoilersRevealed : t.safe;
  const replayStatus = atEnd ? t.replayComplete : t.replayStatus;
  const hidden = (surface: Surface) => state.surface === surface ? "" : " hidden";
  return `<main class="replay-page">${sourceBanner()}<section class="replay-head"><button class="back-to-picker" id="back-to-picker" aria-label="${t.backToMatch}"><span aria-hidden="true">←</span></button><div class="replay-title"><span id="replay-state-label">${replayStateLabel}</span><h1><b class="${teamClass(replay.match.participant1)}">${teamCode(replay.match.participant1.name)}</b> <i>×</i> <b class="${teamClass(replay.match.participant2)}">${teamCode(replay.match.participant2.name)}</b></h1></div><div class="live-chip"><i></i><span id="replay-status-label">${replayStatus}</span></div></section>
    <div class="surface-stack">
      <section class="app-surface live-surface" data-testid="surface-live" data-surface-panel="live"${hidden("live")}><div id="score-slot" data-key="${scoreRenderKey(replay)}">${scoreboard(replay)}</div><div id="pulse-slot" data-key="${pulseRenderKey(replay)}">${livePulse(replay)}</div><div id="turning-slot" data-key="${turningRenderKey(replay)}">${turningPoint(replay)}</div><div id="ending-slot" data-key="${endingRenderKey(replay)}">${ending(replay)}</div></section>
      <section class="app-surface moments-surface" data-testid="surface-moments" data-surface-panel="moments"${hidden("moments")}><div id="timeline-slot" data-key="${timelineRenderKey(replay)}">${timeline(replay)}</div></section>
      <section class="app-surface collection-surface" data-testid="surface-collection" data-surface-panel="collection"${hidden("collection")}><div id="collection-slot" data-key="${collectionRenderKey(replay)}">${collection(replay)}</div></section>
      <section class="app-surface proof-surface" data-testid="surface-proof" data-surface-panel="proof"${hidden("proof")}><div id="provenance-slot" data-key="${provenanceRenderKey(replay)}">${provenance(replay)}</div></section>
    </div>
    ${controls(replay)}
    <nav class="app-tabs" aria-label="${t.appNavLabel}">
      <button data-surface="live" aria-current="${state.surface === "live" ? "page" : "false"}"${state.surface === "live" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">◉</span><strong>${t.tabLive}</strong></button>
      <button data-surface="moments" aria-current="${state.surface === "moments" ? "page" : "false"}"${state.surface === "moments" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">≋</span><strong>${t.tabMoments}</strong></button>
      <button data-surface="collection" aria-current="${state.surface === "collection" ? "page" : "false"}"${state.surface === "collection" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">◈</span><strong>${t.tabCollection}</strong></button>
      <button data-surface="proof" aria-current="${state.surface === "proof" ? "page" : "false"}"${state.surface === "proof" ? "" : " tabindex=\"-1\""}><span aria-hidden="true">◇</span><strong>${t.tabProof}</strong></button>
    </nav>
    ${commerceModal()}
  </main>`;
}

function render(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  if (playbackFrame !== null) window.cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
  const focusedId = document.activeElement instanceof HTMLElement && app.contains(document.activeElement)
    ? document.activeElement.id
    : "";
  document.documentElement.lang = state.lang;
  updateDocumentMetadata();
  document.body.dataset.view = state.view;
  document.body.dataset.source = state.replay?.source.mode ?? "pending";
  if (state.replay && state.view === "replay") updateReplayPhase(state.replay);
  else {
    delete document.body.dataset.replayPhase;
    delete document.body.dataset.autoPaused;
  }
  let body = loading();
  if (state.view === "error") body = errorView();
  else if (state.view === "picker" && state.replay) body = picker(state.replay);
  else if (state.view === "replay" && state.replay) body = replayView(state.replay);
  app.innerHTML = `<div class="app-shell" data-testid="app-shell">${header()}${body}<div id="announcer" class="sr-only" aria-live="polite">${state.justAutoPaused ? copy(state.lang).autoPaused : ""}</div><div id="toast" class="toast" role="status" aria-live="polite"></div></div>`;
  bind();
  applyMomentumBars();
  if (state.view === "replay") activateSurface(state.surface);
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

function togglePlayback(): void {
  if (!state.replay) return;
  state.justAutoPaused = false;
  if (state.playheadMs >= state.replay.playbackDurationMs) {
    state.playheadMs = 0;
    state.autoPauseHandled = false;
  }
  state.playing = !state.playing;
  if (state.playing) {
    ensureAudio();
    startTimer();
  }
  else stopTimer();
  schedulePlaybackDomUpdate();
}

function continueReplay(): void {
  if (!state.replay) return;
  state.justAutoPaused = false;
  state.playing = true;
  ensureAudio();
  startTimer();
  schedulePlaybackDomUpdate();
}

function showToast(message: string): void {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
    toastTimer = null;
  }, 2_600);
}

async function claimLegendaryCollectible(): Promise<void> {
  if (!state.replay) return;
  state.commerceView = "minting";
  render();
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Idempotency-Key": collectibleClaimKey(),
    };
    const judgeAccess = window.sessionStorage.getItem(JUDGE_ACCESS_STORAGE_KEY);
    if (judgeAccess) headers["X-Judge-Access"] = judgeAccess;
    const response = await fetch("/api/collectibles/legendary-91/claim", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as { collectible?: unknown };
    if (!response.ok || !isCollectedCard(body.collectible)) throw new Error("mint_not_confirmed");
    state.mintedCard = body.collectible;
    try {
      window.localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(body.collectible));
    } catch {
      // Keep the confirmed result in memory when storage is unavailable.
    }
    state.commerceView = "success";
    render();
  } catch {
    state.commerceView = "error";
    render();
  }
}

function shareCurrentMoment(): void {
  const t = copy(state.lang);
  const text = state.replay?.turningPoint ? turningPointNarrative(state.replay) : t.socialDescription;
  const shareData = { title: t.socialTitle, text, url: `${window.location.origin}${window.location.pathname}` };
  void (async () => {
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      } else throw new Error("sharing_unavailable");
      showToast(t.shared);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast(t.shareFailed);
    }
  })();
}

function applyMomentumBars(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-testid=\"momentum\"]")) {
    const share1 = Number(node.dataset.share1 ?? "50");
    const knob = node.querySelector<HTMLElement>(".momentum-knob");
    if (knob) knob.style.left = `${100 - share1}%`;
  }
}

function bindDynamicControls(): void {
  applyMomentumBars();
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
      toggleMomentLocally(state.replay);
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
      state.lastCelebratedSeq = 0;
      activateSurface("live");
      schedulePlaybackDomUpdate();
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }
  for (const unlock of document.querySelectorAll<HTMLButtonElement>("#unlock-legendary")) {
    if (unlock.dataset.bound === "true") continue;
    unlock.dataset.bound = "true";
    unlock.addEventListener("click", () => {
      state.commerceView = "pricing";
      render();
    });
  }
  for (const claim of document.querySelectorAll<HTMLButtonElement>("#claim-legendary")) {
    if (claim.dataset.bound === "true") continue;
    claim.dataset.bound = "true";
    claim.addEventListener("click", () => void claimLegendaryCollectible());
  }
  const ownedCollection = document.querySelector<HTMLButtonElement>("#open-owned-collection");
  if (ownedCollection && ownedCollection.dataset.bound !== "true") {
    ownedCollection.dataset.bound = "true";
    ownedCollection.addEventListener("click", () => activateSurface("collection"));
  }
  const legendaryPreview = document.querySelector<HTMLButtonElement>("#view-legendary-card");
  if (legendaryPreview && legendaryPreview.dataset.bound !== "true") {
    legendaryPreview.dataset.bound = "true";
    legendaryPreview.addEventListener("click", () => {
      state.commerceView = "preview";
      render();
    });
  }
}

function bind(): void {
  document.querySelector("#lang")?.addEventListener("click", () => {
    state.lang = state.lang === "pt-BR" ? "en" : "pt-BR";
    render();
  });
  document.querySelector("#retry")?.addEventListener("click", () => void requestReplay(`/api/replays/${ACTIVE_REPLAY_FIXTURE_ID}`));
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
    state.lastCelebratedSeq = 0;
    ensureAudio();
    navigateTo("replay");
    state.playing = true;
    startTimer();
    schedulePlaybackDomUpdate();
  });
  document.querySelector("#sound")?.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    window.localStorage.setItem(SOUND_STORAGE_KEY, state.soundEnabled ? "1" : "0");
    ensureAudio();
    render();
  });
  document.querySelector("#back-to-picker")?.addEventListener("click", () => navigateTo("picker"));
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-surface]")) {
    tab.addEventListener("click", () => activateSurface(tab.dataset.surface as Surface));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const order: Surface[] = ["live", "moments", "collection", "proof"];
      const current = order.indexOf(tab.dataset.surface as Surface);
      const next = (current + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length;
      activateSurface(order[next], true);
    });
  }
  document.querySelector("#close-commerce")?.addEventListener("click", () => {
    state.commerceView = "closed";
    render();
  });
  document.querySelector("#retry-mint")?.addEventListener("click", () => void claimLegendaryCollectible());
  document.querySelector("#open-collection")?.addEventListener("click", () => {
    state.commerceView = "closed";
    state.surface = "collection";
    render();
  });
  document.querySelector("#collection-premium")?.addEventListener("click", () => {
    state.commerceView = "pricing";
    render();
  });
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
    schedulePlaybackDomUpdate();
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
