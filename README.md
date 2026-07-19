# Torcida Pulse

**Live the match. Collect the impossible.**

Torcida Pulse is a live-first football companion built on real TxLINE match
data. It follows the game as it happens, turns the biggest swings into a live
**Pulse** signal, and when a moment is rare enough it becomes an on-chain
**drop** you can collect. The product is for fans, not bettors: the Pulse is an
opaque TxLINE signal, never a prediction, and there is no wagering, custody, or
financial advice in the consumer flow.

The same experience also catches you up fast. If you arrive late, a **20-second
spoiler-safe catch-up** lands you exactly at the live edge; and a **20-second
replay** lets you relive any finished match. The focus is live — everything is
built so a late arriver reaches *now* in twenty seconds and then stays in the
flow of the match.

## The live experience

1. The fan opens the app to a live fixture catalog (World Cup matches pulled
   from TxLINE). Live matches are surfaced first with a one-tap **Enter the live
   match**.
2. Pressing play starts a **20-second catch-up** that progressively reveals
   score events, the Pulse, and the timeline without spoiling the final result.
3. When playback reaches the live edge, the app says *"You're now caught up with
   the live match"* and score, events, and Pulse **keep updating automatically
   every 5 seconds** (`REPLAY_CONTRACT.playbackDurationMs` = 20 000 ms;
   `refreshLiveReplay` polls every 5 s in `src/main.ts`).
4. The **Pulse** reacts to every play in real time. When a goal or turning point
   moves the TxLINE signal, the Pulse shows a signed percentage-point change
   (`src/fan.ts`, `livePulse` render in `src/main.ts`).
5. A rare enough swing becomes a **drop**. Fans watching live can unlock that
   instant; the most dramatic comebacks are offered as a **Legendary** collectible
   (the "Turning Point Drop"), minted on Solana devnet. The unlock is automatic;
   minting/collecting is always the fan's explicit choice.

   > **On the Legendary artwork (be honest about what ships today).** The drop
   > card you see in the current replay — the England 1–2 Argentina 91′ reversal
   > — uses a single **pre-generated example image** (`public/legendary-turning-point.webp`)
   > that we created by hand as a concept piece. It is *not* generated per match
   > and the metadata says so (`Artwork: "Pre-generated generative AI example"`).
   > It exists to show what the drop looks and feels like. The **product vision**
   > is to generate each Legendary artwork automatically and uniquely from that
   > match's own data (teams, score, minute, TxLINE swing) and mint that unique
   > piece — but that generation pipeline is not built yet, so we do not claim it
   > works. What is real today: the turning-point detection, the drop card UI, and
   > the on-chain devnet mint pointing at the example artwork.

## The 20-second catch-up and replay

- The match clock is compressed linearly into **20 seconds**. For a match ending
  at minute `M`, an event at minute `m` is placed at `(m / M) * 20_000` ms
  (anchored at kickoff). The inverse `(playbackMs / 20_000) * M` recovers the
  source minute (`src/replay-contract.ts`, `src/timeline.ts`).
- **Catch-up** takes a late arriver from kickoff to the live edge in 20 seconds.
- **Replay** re-runs any finished match in 20 seconds and auto-pauses at the
  **Turning Point** — preferring a factual reversal of the match leader over an
  earlier opening goal.
- Both use the same spoiler-safe reveal: score, events, Pulse, and proof appear
  only as you advance. The provenance/proof surface stays collapsed until the
  turning point is revealed.

## The Pulse and the turning-point drop

- The Pulse compares only an identical returned tuple:
  `(BookmakerId, SuperOddsType, MarketPeriod, MarketParameters, PriceName)`.
- It selects the largest `Pct` change inside the two snapshots around an event
  and presents `Pct` as an opaque TxLINE signal, **not** a prediction
  (`src/virada-index.ts`, `src/momentum.ts`, `src/fan.ts`).
- The factual card names the event team, the exact returned `PriceName`, the
  before/after values, and the signed percentage-point delta. A plain-language
  notice states the signal is *not* win probability and that timing is not
  causation, prediction, or wagering advice.
- When the signal jump is large enough that a drop is warranted, the turning
  point becomes a candidate **Legendary**. The "Comeback Index"
  (`src/virada-index.ts`) scores `standard` / `classic` / `rare` / `epic` /
  `legendary` tiers from score
  impact, decisive minute, lead speed, and TxLINE shock. The 91′ 1–2 lead
  reversal of the reference fixture is the canonical Legendary moment.
- If the two snapshots contain no comparable tuple, the app shows an honest
  no-drop state. It never invents a turning point or a drop.

## Designed to be remembered

- The picker uses a paper editorial system, a score-locked match ticket, and an
  original CSS Pulse mark — no tournament marks, stock art, or in-app image
  payload.
- The ticket renders the factual fixture `startTime` in the viewer's IANA
  timezone. Picker/replay navigation uses browser history and reuses the loaded
  envelope instead of refetching TxLINE.
- The live Pulse is a distinct visual mode: a live dot on the score, a circular
  progress ring, and an impact card that animates with each goal.
- The Legendary forge pauses the replay at the comeback, reveals the drop
  card, and only then offers mint/collect. The fixed player gets out of the
  way so its Continue action is not duplicated over the climax. Today the card
  shows the pre-generated example artwork described above; the intended final
  behavior is to render artwork generated uniquely from the match's own data.
- Native share sends the factual match story with visible success feedback; the
  local memory/collection controls are reversible and store no match or TxLINE
  field server-side. Production E2E enforces the full responsive/i18n/axe matrix
  across picker, live edge, replay, error, and collection states.

## Real-data path

- `GET /api/replays/<active-manifest-fixture>` is the real, fail-closed TxLINE
  route. In production it requires a private judge access code and an explicit
  automatic shutdown timestamp. Missing/rejected credentials, expired access, or
  an absent shutdown window produce an error; this route never falls back.
- There is no synthetic/demo API route in the production server. `/api/demo`
  returns 404, and the browser rejects any envelope that is not `real_txline`.
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

The active fixture and epoch are owned by `config/replay-manifest.json`. Its gate
turns red at `rotateBefore`, two days before historical eligibility ends at
`historicalEligibleUntil`. Observed Devnet behavior (and the 91′ 1–2 reversal with
a 12.989% → 88.652% `Pct` change between identical tuples) is documented in
`PROJECT_STATE.md` and the submission records; the current proof response has a
timestamp mismatch for the observed sequence, so provenance is honestly reported
as `unavailable` until re-smoked.

## Provenance (truthful Solana devnet)

- The provenance card is green only after a real
  `validateStatV2(...).view()` succeeds against the exact devnet daily score root.
- Proof states: `verified` (green), `unavailable` (proof endpoint/shape/RPC
  timeout), `failed` (rejected or simulation failed). `odds_unavailable` keeps
  the score timeline usable; `unavailable` is never a green badge or an eternal
  loader.
- The devnet IDL is pinned to an upstream TxODDS commit and verified by
  SHA-256. Read-only simulation uses a funded devnet **public address** as fee
  payer; it never needs or signs with a private key. The UI links that PDA to
  Explorer devnet and explicitly says the check is a read-only simulation with no
  transaction signature.

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
on all interfaces, serves the Vite build and same-origin API, and sets a
restrictive CSP. **Static hosting is unsupported** — use Node or the Dockerfile.

## Verify

```bash
npm test             # unit + authenticated adapter integration
npm run test:e2e     # managed Chromium; responsive/i18n/axe matrix
npm run test:security
npm run smoke        # deploy-like server smoke; real route must fail closed
npm run check:replay-manifest # fails before historical eligibility expires
npm run check:submission-packets # same three URLs + current double-submit fields
BASE_URL=https://… JUDGE_ACCESS_TOKEN=… npm run smoke:deployed # private judge gate (only if a real deployment exists)
npm run smoke:real   # official TxLINE + actual devnet view; submission gate
npm run smoke:real:env # same gate, loading the ignored local .env safely
npm run smoke:real:browser:env # real production Chromium + axe
npm run preflight:subscription # unsigned Devnet subscription simulation only
```

The current deterministic verification uses Chromium managed by Playwright and
CI runs `npm ci`, `npx playwright install --with-deps chromium`, then `npm run
verify`. Recent gates verified: all five authenticated endpoint shapes and both
auth headers; duplicate/correction, missing fields, UTC/BRT boundary, 401/403,
timeout, retry and 5xx behavior; fixture `18241006` produced ten curated
milestones with the 91′ 1–2 leader reversal; initial DOM contains no future
score, event, odds, proof, or endpoint detail; match `startTime` appears in the
picker DOM at the browser timezone; history back/forward crosses
picker/replay without an additional API request; auto-pause, play/pause,
scrub/reveal/return, no horizontal overflow, 44 px targets, CTA inside the fold,
and zero axe violations across every language, width, and
picker/live/replay/error/collection state. See `PROJECT_STATE.md` for the exact
test counts and the most recent `npm run verify` result.

## Competition compliance

The application minimizes TxODDS data exposure: it has no raw-data capture,
general-purpose proxy, analytics, persistence, resale, wagering, tournament
marks, or end-user wallet flow. The drop/collection layer is a demonstrable,
judge-gated feature that ends at Premium-plan selection and a devnet demo
receipt — it does not run real payments or custody. Entrants remain responsible
for eligibility, regional requirements, official terms, and submitting the same
project to the global Consumer track and the Brasil listing.

This project was created during the 2026 TxODDS World Cup hackathon period; it
is not a repackaged legacy submission. The current terms require a human
participant to own, materially review, and submit it. The required human leader
identity and review attestation are intentionally not fabricated in Git; they
must be completed in [docs/HUMAN_OWNERSHIP.md](docs/HUMAN_OWNERSHIP.md) before
any public push or submission.

Do not deploy the real-data route without TxODDS authorization for the exact
normalized surfaces. The route remains judge-gated, rate-limited, `noindex`,
and auto-disabled at `REAL_DATA_DISABLE_AT`.

**This hackathon submission includes no public HTTPS deployment.** It is
delivered as a public GitHub repository plus a locally captured demo video
(`docs/SUBMISSION_STRATEGY.md`). `LIVE_URL`/`REPO_URL` point at the repository and
`VIDEO_URL` at the recording; the real-data route stays behind the private judge
code and is never shown in public video/screenshots.

## Sustainable path (post-hackathon, licence-dependent)

Torcida Pulse can be licensed as a B2B white-label live companion for clubs,
broadcasters, and streaming apps: live spoiler-safe catch-up, on-chain rare
drops at the biggest swings, verified score provenance, and share output. This
path is conditional on a commercial TxLINE data licence. The manifest-governed
contest slice proves the complete live + catch-up interaction with a finished
real-data fixture and labels it honestly; continuous SSE handoff and a
multi-match picker remain post-permission integrations, not hidden mock features.

## License

Torcida Pulse code is MIT licensed. The pinned TxODDS IDL retains its upstream
Apache-2.0 terms; see `THIRD_PARTY_NOTICES.md` and `LICENSE-APACHE-2.0`.
