# Torcida Pulse

**Reviva o jogo em 20 segundos sem spoilers: Torcida Pulse pausa sozinho no
Momento da Virada, revela como o pulso TxLINE mudou ao redor do lance e verifica
o placar na Solana.**

Torcida Pulse is a PT-BR-first, mobile replay for fans, not a betting product.
There are no bets, predictions, trades, wallets, custody, or financial advice in
the consumer flow.

## The 20-second experience

1. The judge opens one finished match without seeing its result.
2. Play/pause and the scrubber progressively reveal score events over 20 seconds.
3. Playback auto-pauses at **Momento da Virada**, preferring a factual reversal
   of the match leader over an earlier opening goal.
4. The card compares only an identical returned tuple:
   `(BookmakerId, SuperOddsType, MarketPeriod, MarketParameters, PriceName)`.
5. It selects the largest `Pct` change inside those two snapshots and presents
   `Pct` as an opaque TxLINE signal, not a prediction.
6. Copy says the movement **coincided with** the event; it never claims causation.
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
- Entering replay changes the visual mode to a dark broadcast console while the
  score and future events remain absent from the DOM.
- Auto-pause deliberately hands the 375 px viewport to one hot-pink Virada
  composition: factual 91′ lead reversal, then-current 1–2 score, and exactly
  two plotted TxLINE snapshot points. It never draws a fictional continuous
  history.
- The proof layer uses a separate cobalt system so consumer story and technical
  trust are visually distinct.
- Production E2E enforces the full 30-state matrix: 320/375/1280 px × PT-BR/EN
  × picker/initial/auto-pause/final/error, with unfiltered axe, keyboard, CTA
  inside the fold, backward scrub, explicit fallback, history, and social assets.
- The complete production frontend is about **15.51 kB gzip** across HTML, CSS,
  and JavaScript, with no visual framework, external font, or runtime image.

## Real path and fictional path are separate

- `GET /api/replays/18241006` is the real, fail-closed TxLINE route. Missing or
  rejected credentials produce an error; this route never falls back.
- `GET /api/demo` is an explicit fictional test scenario. Its teams and IDs are
  invented, it carries a permanent warning, and its proof state is always
  `synthetic_unverified`.
- The browser has no live toggle and no credential code.

## TxLINE calls in the frozen slice

The server uses both `Authorization: Bearer …` and `X-Api-Token` without logging
or returning either value.

| Purpose | Server call |
| --- | --- |
| Find frozen fixture | `GET /api/fixtures/snapshot?startEpochDay=20649` |
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
retry or throw. Official keys
`1` and `2` are canonical for the two goal totals and must match the proof.
`ScoreSoccer`/`scoreSoccer` and participant nesting remain supported as the
fallback. `Clock.Seconds` supplies match minutes. Delivery telemetry is reduced
to ten fan milestones; non-score-changing goal deliveries are excluded.

Identical deliveries collapse. Conflicting rows with the same `seq` are
surfaced and resolved deterministically; they are not silently lost.

The server returns only the narrow normalized interface in `src/types.ts`.
Raw TxLINE payloads and proof blobs are not stored, committed, cached, or sent to
the browser. The fixed route is not a general-purpose proxy.

## Proof states

| State | Meaning | Green? |
| --- | --- | --- |
| `verified` | HTTP proof received and `validateStatV2.view()` returned true | Yes |
| `unavailable` | proof endpoint/shape/root payer unavailable | No |
| `failed` | proof rejected or the on-chain simulation failed | No |
| `synthetic_unverified` | explicit fictional scenario | No |

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
- `PORT` — injected by the host; defaults to `4173`.

Production:

```bash
npm run build
npm start
```

The repository includes a multi-stage `Dockerfile`. The production server binds
on all interfaces, serves the Vite build and same-origin API, sets a restrictive
CSP, and returns `Cache-Control: no-store` for API responses. Unexpected server
errors emit only a UUID request ID, allowlisted route/code, duration, status and
sanitized server-side stack frames; headers, env, proof and payload are excluded.

## Verify

```bash
npm test             # unit + authenticated adapter integration
npm run test:e2e     # managed Chromium; 30-state responsive/i18n/axe matrix
npm run test:security
npm run smoke        # deploy-like server smoke; real route must fail closed
BASE_URL=https://… npm run smoke:deployed # TLS/host/replay/proof/CSP/375px gate
npm run smoke:real   # official TxLINE + actual devnet view; submission gate
npm run smoke:real:env # same gate, loading the ignored local .env safely
npm run smoke:real:browser:env # real production Chromium at 375 px + axe
npm run preflight:subscription # unsigned Devnet subscription simulation only
```

Current deterministic verification uses Chromium managed by Playwright, and CI
runs `npm ci`, `npx playwright install --with-deps chromium`, then `npm run
verify`. The current matrix contains 42 unit/integration tests and 41 production
browser tests. The most recent activated official Devnet gate on 2026-07-18 also
verified:

- all five authenticated endpoint shapes and both auth headers;
- duplicate/correction, missing fields, UTC/BRT boundary, 401/403, timeout,
  retry and 5xx behavior;
- fixture `18241006` produced ten curated milestones; the 91′ goal reversed the
  leader to 1–2 and coincided with a 12.989%→88.652% `Pct` change between
  identical tuples in the two snapshots around that event (75.663 percentage
  points); the proof view returned true for sequence `871` and epoch day `20649`;
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

## License

Torcida Pulse code is MIT licensed. The pinned TxODDS IDL retains its upstream
Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `LICENSE-APACHE-2.0`.
