# Torcida Pulse

**Chegou atrasado? Torcida Pulse transforma o que você perdeu em um catch-up de
20 segundos sem spoiler e leva você até o agora — pronto para continuar no
ritmo do jogo ao vivo.**

Torcida Pulse is a PT-BR-first, mobile live catch-up experience for fans, not a
betting product. Its current real-data fixture demonstrates the complete
spoiler-safe catch-up path with a finished match: progressive TxLINE events,
automatic pause at the Turning Point, and truthful Solana provenance.
There are no bets, predictions, trades, wallets, custody, or financial advice in
the consumer flow.

## The 20-second live catch-up experience

1. The fan opens one finished match without seeing its result.
2. One explicit `Watch spoiler-free` tap starts playback; play/pause and the
   scrubber progressively reveal score events over 20 seconds.
3. Playback auto-pauses at **Momento da Virada**, preferring a factual reversal
   of the match leader over an earlier opening goal.
4. The card compares only an identical returned tuple:
   `(BookmakerId, SuperOddsType, MarketPeriod, MarketParameters, PriceName)`.
5. It selects the largest `Pct` change inside those two snapshots and presents
   `Pct` as an opaque TxLINE signal, not a prediction.
6. The factual card names the event team, exact returned `PriceName`, before,
   after, and signed percentage-point delta. A separate notice says the timing
   is not causation, prediction, or wagering advice.
7. The provenance card is green only after a real `validateStatV2(...).view()`
   succeeds against the exact devnet daily score root.

If the two snapshots contain no comparable tuple, the app shows an honest
no-card state. It never invents a turning point.

## Designed to be remembered

- The picker uses a paper editorial system, a score-locked match ticket, and an
  original CSS Pulse mark—no tournament marks, stock art, or in-app image payload.
- The ticket renders the factual fixture `startTime` in the viewer's IANA
  timezone. Picker/replay navigation uses browser history and reuses the loaded
  envelope instead of refetching TxLINE.
- Entering replay starts it in one tap and changes the visual mode to a dark
  broadcast console while the score and future events remain absent from the DOM.
- Auto-pause deliberately hands the 375 px viewport to one hot-pink Virada
  composition: factual 91′ lead reversal, then-current 1–2 score, and exactly
  two plotted TxLINE snapshot points. It never draws a fictional continuous
  history. The fixed player gets out of the way so its Continue action is not
  duplicated over the climax.
- The signal card says in plain language that the pulse is not win probability.
  Native share sends the factual match story with visible success feedback;
  the local memory control is reversible and stores no match or TxLINE field.
- Completed replay controls return to document flow instead of covering the
  ending, and no disabled notification/signup action is shown.
- The proof layer uses a separate cobalt system so consumer story and technical
  trust are visually distinct.
- Production E2E enforces the full 30-state matrix: 320/375/1280 px × PT-BR/EN
  × picker/initial/auto-pause/final/error, with unfiltered axe, keyboard, CTA
  inside the fold, one-tap start, backward scrub, fail-closed errors,
  share/save behavior, history, and social assets.

## Real-data path

- `GET /api/replays/<active-manifest-fixture>` is the real, fail-closed TxLINE route. In
  production it requires a private judge access code and an explicit automatic
  shutdown timestamp. Missing/rejected credentials, expired access, or an
  absent shutdown window produce an error; this route never falls back.
- There is no synthetic/demo API route in the production server. `/api/demo`
  returns 404, and the browser rejects any envelope that is not `real_txline`.
- A judge can enter the separately supplied code; it stays in `sessionStorage`
  and is sent only as a same-origin header to the manifest-selected real route.
- The browser aborts at 12 seconds and renders a retryable, fail-closed error;
  unavailable real data is never replaced with invented match data.
- `GET /api/live` proves only that the process is alive. `GET /api/ready`
  remains 503 until the normalized real replay has passed prewarm.

## TxLINE calls in the active replay manifest

The server uses both `Authorization: Bearer …` and `X-Api-Token` without logging
or returning either value.

| Purpose | Server call |
| --- | --- |
| Find active fixture | `GET /api/fixtures/snapshot?startEpochDay=20649` |
| Replay factual events | `GET /api/scores/historical/18241006` |
| Comparable state before event | `GET /api/odds/snapshot/18241006?asOf=<eventTs-120s>` |
| Comparable state after event | `GET /api/odds/snapshot/18241006?asOf=<eventTs+120s>` |
| Score proof for observed sequence | `GET /api/scores/stat-validation?fixtureId=18241006&seq=<observed>&statKeys=1,2` |

Observed Devnet behavior differs from the generated reference: the historical
route returned a finite `text/event-stream` containing JSON `data:` frames, not
one JSON array. The adapter accepts that framing only for `scores_historical`
and rejects malformed/oversized frames. Live records expose sparse
participant-nested `Score` updates plus the complete `Stats` map. All JSON and
finite SSE bodies use one reader capped while streaming at 16 MiB, before any
unbounded whole-body allocation;
oversized responses abort, and every rejected/5xx body is cancelled before a
retry or throw. Authenticated fetches reject redirects before follow, so a
custom token can never be forwarded to another origin. A 200 is recorded as
evidence only after its bounded body parses completely. Official keys
`1` and `2` are canonical for the two goal totals and must match the proof.
`ScoreSoccer`/`scoreSoccer` and participant nesting remain supported as the
fallback. `Clock.Seconds` supplies match minutes. Delivery telemetry is reduced
to ten fan milestones; non-score-changing goal deliveries are excluded.

Every score and odds row must explicitly match the selected `FixtureId`.
Top-level live `Participant: 1|2` values are mapped to the selected fixture's
actual team IDs/names and participate in delivery identity. Identical
deliveries collapse. Conflicting rows with the same `seq` are surfaced and
resolved deterministically; they are not silently lost. Decreasing delivery
timestamps are projected monotonically by sequence; future goals/final state
can never appear at playhead zero.

The 20-second fan replay is a linear compression of the recorded match clock,
not of delivery sequence numbers. For a match ending at minute `M`, an event at
minute `m` is placed at `(m / M) * 20_000` milliseconds (anchored at kickoff).
The inverse `(playbackMs / 20_000) * M` therefore recovers the source match
minute within JavaScript floating-point precision. Delivery timestamps are used
only when the normalized match clock is absent or non-monotonic.

The complete server operation has one 12-second deadline. Each Solana RPC fetch
is independently abortable at three seconds. Odds timeout preserves the score
timeline with `turningPointReason: "odds_unavailable"`; proof timeout becomes
`unavailable`, never a green badge or an eternal loader.

The server returns only the narrow normalized interface in `src/types.ts`.
Raw TxLINE payloads and proof blobs are not stored, committed, cached, or sent
to the browser. Only the authorized normalized envelope is cached, with
single-flight preventing duplicate upstream calls/simulations. The selected route
is rate-limited and is not a general-purpose proxy. An odds-only failure yields
`turningPoint: null` plus `turningPointReason: "odds_unavailable"`; timeline
and proof remain usable.

## Proof states

| State | Meaning | Green? |
| --- | --- | --- |
| `verified` | HTTP proof received and `validateStatV2.view()` returned true | Yes |
| `unavailable` | proof endpoint/shape/root payer/RPC timeout unavailable | No |
| `failed` | proof rejected or the on-chain simulation failed | No |

The devnet IDL is pinned to upstream TxODDS commit
`3a1d6f0cfc34ce173f0778023d2332161359196d` and verified by SHA-256. Read-only
simulation uses a funded devnet **public address** as fee payer; it never needs
or signs with a private key. A real proof response also exposes the derived
daily-scores PDA, exact proof target timestamp, and checked-at time. The UI links
that PDA to Explorer devnet and explicitly says the check is a read-only
simulation with no transaction signature.

## Safe subscription preflight

Before authorizing any wallet action, verify the live Devnet pricing matrix and
simulate the exact free-tier transaction using only the disposable wallet's
public address:

```bash
SOLANA_SIMULATION_PAYER=<funded-devnet-public-address> npm run preflight:subscription
```

The preflight pins the Devnet genesis, program and Token-2022 mint; requires
service level `1` to cost zero tokens; permits only the associated-token and
TxLINE program instructions; and checks wallet balance/history before and after
simulation. Its signer and send methods deliberately throw. It does not read a
keypair, sign, broadcast, request a guest JWT, or activate API access.

## Run

Requirements: Node.js `^20.19.0` or `>=22.12.0` and npm 10+. `.nvmrc` pins the
reproducible path to Node 22.12.0.

```bash
nvm use
npm ci
npx playwright install --with-deps chromium
cp .env.example .env
# Fill server-side values only; never prefix them with VITE_.
npm run dev
```

Environment:

- `TXLINE_GUEST_JWT` — secret guest JWT.
- `TXLINE_API_TOKEN` — secret activated TxLINE token.
- `SOLANA_SIMULATION_PAYER` — public address of a funded devnet system account;
  no private key.
- `JUDGE_ACCESS_TOKEN` — production-only private code (minimum 16 characters),
  supplied to judges through private submission notes.
- `REAL_DATA_DISABLE_AT` — required ISO-8601 cutoff for automatic real-route
  shutdown; use only a date authorized in writing by TxODDS.
- `REPLAY_CACHE_TTL_MS`, `REPLAY_RATE_LIMIT_MAX`, and
  `REPLAY_RATE_LIMIT_WINDOW_MS` — bounded normalized cache/rate controls.
- `PORT` — injected by the host; defaults to `4173`.

Production:

```bash
npm run build
npm start
```

The repository includes a multi-stage `Dockerfile`. The production server binds
on all interfaces, serves the Vite build and same-origin API, sets a restrictive
CSP plus `X-Robots-Tag: noindex`, and returns `Cache-Control: no-store` for API
responses. Unexpected server errors emit only a UUID request ID, allowlisted
route/code, duration, status and sanitized server-side stack frames; headers,
env, proof and payload are excluded.

## Verify

```bash
npm test             # unit + authenticated adapter integration
npm run test:e2e     # managed Chromium; 30-state responsive/i18n/axe matrix
npm run test:security
npm run smoke        # deploy-like server smoke; real route must fail closed
npm run check:replay-manifest # fails two days before historical eligibility expires
npm run check:submission-packets # same three URLs + current double-submit fields
BASE_URL=https://… JUDGE_ACCESS_TOKEN=… npm run smoke:deployed # deployed private judge gate
npm run smoke:real   # official TxLINE + actual devnet view; submission gate
npm run smoke:real:env # same gate, loading the ignored local .env safely
npm run smoke:real:browser:env # real production Chromium at 375 px + axe
npm run preflight:subscription # unsigned Devnet subscription simulation only
```

Current deterministic verification uses Chromium managed by Playwright, and CI
runs `npm ci`, `npx playwright install --with-deps chromium`, then `npm run
verify`. The hardened matrix contains 68 unit/integration tests and 48 production
browser tests. The most recent activated official Devnet gate on 2026-07-18 also
verified:

- all five authenticated endpoint shapes and both auth headers;
- duplicate/correction, missing fields, UTC/BRT boundary, 401/403, timeout,
  retry and 5xx behavior;
- fixture `18241006` produced ten curated milestones; the 91′ goal reversed the
  leader to 1–2 and coincided with a 12.989%→88.652% `Pct` change between
  identical tuples in the two snapshots around that event (75.663 percentage
  points); the current proof response has a timestamp mismatch for sequence
  `871`, so provenance remains honestly `unavailable`;
- official real input changes teams, timeline, score and turning-point values
  rendered by the production browser;
- initial DOM contains no future score, event, odds, proof, or endpoint detail;
- match `startTime` appears in the picker DOM at the browser timezone; history
  back/forward crosses picker/replay without an additional API request;
- auto-pause, play/pause, scrub/reveal/return, no horizontal overflow, 44 px
  targets, CTA inside the fold, and zero axe violations across every language,
  width and picker/replay/error state in the deterministic matrix;
- current tree and public-HEAD ancestry exclusion/secret scan, browser bundle
  scan, pinned-IDL hash, production CSP and high/critical production dependency
  audit.

The five moderate production advisories are inherited through the official
Anchor/Solana dependency chain (`jayson` → `uuid`) and have no available fix;
the application does not call the affected UUID buffer APIs.

## Competition compliance

The application minimizes TxODDS data exposure: it has no raw-data capture,
general-purpose proxy, analytics, persistence, resale, wagering, tournament
marks, or end-user wallet flow. Entrants remain responsible for eligibility,
regional requirements, official terms, and submitting the same project to the
global Consumer track and the Brasil listing.

This project was created during the 2026 TxODDS World Cup hackathon period; it
is not a repackaged legacy submission. The current terms require a human
participant to own, materially review, and submit it. The required human leader
identity and review attestation are intentionally not fabricated in Git; they
must be completed in [docs/HUMAN_OWNERSHIP.md](docs/HUMAN_OWNERSHIP.md) before
any public push or submission.

Do not deploy the real-data route without TxODDS authorization for the exact
normalized surfaces. The route remains judge-gated, rate-limited, `noindex`,
and auto-disabled at `REAL_DATA_DISABLE_AT`.

## Sustainable path (post-hackathon, licence-dependent)

Torcida Pulse can be licensed as a B2B white-label live catch-up layer for
clubs, broadcasters, and streaming apps: spoiler-safe entry during a match,
sponsor-branded Turning Point cards, verified score provenance, and share
output. This path is conditional on a commercial TxLINE data licence. The
manifest-governed contest slice proves the complete catch-up interaction with a
finished real-data fixture and labels it honestly; continuous SSE handoff and a
multi-match picker remain post-permission integrations, not hidden mock features.

## License

Torcida Pulse code is MIT licensed. The pinned TxODDS IDL retains its upstream
Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `LICENSE-APACHE-2.0`.
