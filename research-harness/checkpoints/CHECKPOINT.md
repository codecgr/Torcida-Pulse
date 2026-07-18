# CHECKPOINT — Torcida Pulse submission handoff

Frozen 2026-07-18 07:14 BRT. Verified implementation:
`564b5586c5126f3ecfc1b6f192aef360b6bf4a8a`.

Internal freeze: 2026-07-18 23:00 BRT. Controlling external deadline: Brasil
prose, 2026-07-18 23:59 BRT. The later structured timestamp remains a recorded
conflict and must not be used to delay the double submission.

## What is frozen

Torcida Pulse is one functional Node/Vite product: a mobile PT-BR/EN,
spoiler-safe match replay driven by a five-call TxLINE backend, an exact
same-tuple odds movement card, and honest Solana devnet provenance. It has no
wagering, trade, custody, wallet requirement or financial recommendation.

This is not the retired static frontend. The production artifact requires its
Node server. **Do not use GitHub Pages or upload `dist/` alone.**

## Three URLs required in both forms

- `LIVE_URL`: **[REQUIRED — HTTPS Node/Docker deployment]**
- `VIDEO_URL`: **[REQUIRED — Loom/YouTube, accessible, <=5:00]**
- `REPO_URL`: **[REQUIRED — public repository]**

Put the identical values in `docs/SUBMISSION_GLOBAL.md` and
`docs/SUBMISSION_BRASIL.md`, then run:

```bash
SUBMISSION_FINAL=1 npm run check:submission-packets
```

It must pass before either form is submitted.

## Exact Node commands

```bash
git switch codex/txodds-release
nvm use
npm ci
npx playwright install --with-deps chromium
npm run verify
npm start
```

Local development only:

```bash
cp .env.example .env
chmod 600 .env
npm run dev
```

Never copy a credential into a command line, URL, log, video, form or Git file.

## Exact Docker commands

The Docker daemon was absent on the verification host, so these commands are
the remaining reproducible container gate; no Docker pass is claimed.

Build:

```bash
docker build --pull --tag torcida-pulse:564b558 .
```

Public synthetic-only mode (no TxLINE secrets):

```bash
docker run --rm --name torcida-pulse -p 4173:4173 \
  -e NODE_ENV=production torcida-pulse:564b558
```

Organizer-authorized private real route (all values prepared in an ignored,
mode-600 `.env`):

```bash
docker run --rm --name torcida-pulse -p 4173:4173 \
  --env-file .env -e NODE_ENV=production torcida-pulse:564b558
```

Then:

```bash
curl --fail http://127.0.0.1:4173/api/live
curl --fail http://127.0.0.1:4173/
```

Do not publish the image or deploy it to a user account without explicit user
authorization.

## Environment contract

Secrets, only in the host secret manager or ignored mode-600 `.env`:

- `TXLINE_GUEST_JWT`
- `TXLINE_API_TOKEN`
- `JUDGE_ACCESS_TOKEN` (minimum 16 characters; never in URL/public notes)

Public/non-secret values:

- `SOLANA_SIMULATION_PAYER` — funded devnet public address, never a keypair
- `REAL_DATA_DISABLE_AT` — ISO-8601 cutoff explicitly authorized by TxODDS
- `REPLAY_CACHE_TTL_MS=300000`
- `REPLAY_RATE_LIMIT_MAX=30`
- `REPLAY_RATE_LIMIT_WINDOW_MS=60000`
- host-provided `PORT`

No `VITE_` secret is allowed. No wallet private key, seed, activation signature,
raw TxLINE payload or proof blob belongs in the deployment.

## Current local evidence

- Clean install: PASS, Node `v22.22.2`, npm `10.9.7`, 125 packages.
- `npm run verify`: PASS.
- Vitest: 67/67 tests in 12 files.
- Playwright: 47/47 E2E, including 320/375/1280 px, PT-BR/EN, full axe,
  keyboard, error/fallback and stale-response behavior.
- Build/typecheck/security/local smoke: PASS.
- Replay manifest and current-form consistency gates: PASS.
- Docker build: NOT RUN; daemon/socket absent.
- Deployed HTTPS smoke: NOT RUN; `LIVE_URL` absent.
- Strict real smoke: five TxLINE HTTP 200 calls and correct replay facts, but
  **NOT GREEN** because the proof timestamp did not match the selected event;
  UI state correctly remained `unavailable`.

Build hashes:

| Artifact | SHA-256 |
| --- | --- |
| `dist/index.html` | `260bc45790c03bbb49ea4e7ee037df7ecd4cdc6647822938e5c1f4ab09703327` |
| `dist/assets/index-CzPSqBMM.js` | `03bf65d147b7db1d05eabe1077c007db2b7c547695058e25ca69d41c972bc2d7` |
| `dist/assets/index-DdlG2TPA.css` | `613aa98113b4ea843ea7e4b3c829a29362e21676017a5478e942d773cf93f70c` |
| `package-lock.json` | `7e6148ce368b0090b0c5cfd61437abdcc79a8ab8541466929b967f14c9760272` |
| `Dockerfile` | `9dba59dfff59f52969704beafe25c3d84a2fcfb1a89ab7fee59306b7b7789185` |
| `config/replay-manifest.json` | `cee4997e2544d5ba93a71a539dedba8cf1c848f07e60b68c1d071ecdc67ffeb7` |

## Pre-deploy and post-deploy gates

Before deploying:

```bash
npm run verify
npm run check:replay-manifest
node --env-file=/absolute/private/.env scripts/real-txline-smoke.mjs
```

The real smoke currently exits non-zero. Do not script around it or call the
proof verified. A video can truthfully show “prova indisponível”; it can show a
green verified badge only after a new strict green run.

After an HTTPS Node/Docker deployment:

```bash
BASE_URL=https://your-final-domain.example \
JUDGE_ACCESS_TOKEN='<same private host value>' npm run smoke:deployed
```

Required result: `DEPLOYED SMOKE OK`. It checks TLS, CSP/noindex, readiness,
five evidence rows, proof state, 375 px Chromium, console/network errors and
secret/proof leakage. If the public deployment is intentionally synthetic-only,
record that limitation and do not pretend this strict private-real gate passed.

## Active fixture rotation

`config/replay-manifest.json` is the only production source for fixture ID,
start epoch, eligibility bounds and strict-smoke expectations.

```bash
npm run check:replay-manifest
```

Current gate:

- fixture `18241006`
- start epoch day `20649`
- rotate before `2026-07-27T19:00:00Z` (16:00 BRT)
- endpoint eligibility ends `2026-07-29T19:00:00Z` (16:00 BRT)

When rotation is due, select an eligible completed fixture through the official
snapshot, update the one manifest, review the expected factual turning point,
and require both real smokes again. Never extend dates while keeping an expired
fixture. No real ReplayEnvelope is stored in this fallback strategy.

Codex automation `txodds-replay-judge-monitor` is ACTIVE daily at 09:00 local
time through 2026-07-29 15:00 UTC. It runs solo, reports only sanitized status,
and never pushes, deploys, submits, accepts terms, spends funds/credits or
contacts an organizer. A local manifest rotation is allowed only when the new
fixture and both strict real smokes are green; otherwise it leaves the branch
unchanged and alerts the user.

## Five-minute demo script

Owner: eligible human team leader. Target length: 4:35; hard stop 4:55. Record
at 375 px. Use real normalized data only if TxODDS has authorized that exact
video; otherwise use the permanently labeled fictional UI and show sanitized
integration evidence/code without implying the fixture is live.

| Time | Screen and narration |
| --- | --- |
| 0:00–0:20 | Title + human owner. “Torcida Pulse is a new hackathon project for fans who missed a match and want the turning point without spoilers—not a betting product.” |
| 0:20–0:45 | Open `LIVE_URL` at 375 px. Point to the source banner. If real loading is slow, wait until the three-second fictional CTA appears and explain the label. |
| 0:45–1:15 | Enter spoiler-free replay. Show that final score, future goals, odds and proof are absent at playhead zero. |
| 1:15–2:00 | Play. Show timeline events reveal progressively and the replay auto-pause at the factual turning point; explain that the card compares only an identical TxLINE odds tuple before/after the event. |
| 2:00–2:35 | Show the score-at-playhead, event team, exact `Pct` points and the non-causal/non-wagering notice. Reveal the final replay. |
| 2:35–3:05 | Show provenance. Say “verified” only if the strict smoke is green. With the current response, say “the proof timestamp did not match, so Torcida Pulse honestly marks it unavailable.” |
| 3:05–3:50 | Split screen: `server/replay-service.ts` and README endpoint table. Walk through exactly five calls: fixture, historical score SSE, odds before, odds after, stat validation. Point out server-only auth and normalized/no-raw response. |
| 3:50–4:15 | Show the timeout tests or terminal summary: 12-second total backend/browser cap, abortable three-second RPC, odds degradation, immediate labeled fallback. |
| 4:15–4:35 | Toggle EN/PT-BR, show mobile fit, repo/deployment/video URLs, new-project statement and “Consumer first, Brasil second, same project.” |

Do not show `.env`, browser devtools headers, guest JWT, API token, judge code,
raw response/proof, wallet secret, private receipt, FIFA marks or an invented
live toggle. Do not say snapshot, live SSE, or proof is working unless the
screen/evidence in that recording proves it.

## Exact submission order and confirmation storage

1. Complete the 12 current Consumer fields in `docs/SUBMISSION_GLOBAL.md`.
2. Submit Consumer first. Save BRT/UTC time, confirmation ID/URL and screenshot
   in ignored `research-harness/records/submissions/private/`; hash it.
3. Put that confirmation into field 3 and “Anything Else” of
   `docs/SUBMISSION_BRASIL.md`.
4. Submit Brasil second using the same three URLs and the explicit double-submit
   sentence. The UI currently says this costs 1 credit and includes a Brazil KYC
   acknowledgement; both are human decisions.
5. Save/hash the Brasil receipt and complete
   `research-harness/records/submissions/CONFIRMATIONS.md`.
6. Reopen both listings and verify they visibly show submitted.

## External action countdown (finish by the 23:00 BRT buffer)

- **T-120 min:** human completes ownership/eligibility/terms review and decides
  synthetic-only versus written-authorized real display.
- **T-105:** fill the three URLs in both packets; run `SUBMISSION_FINAL=1 npm
  run check:submission-packets`.
- **T-95:** authorize and perform public repo push; inspect the public tree for
  `.env`, private receipts, internal harness templates and secrets.
- **T-80:** authorize and deploy the Node/Docker service; never static `dist/`.
- **T-65:** run deployed smoke/incognito walkthrough; correct only blockers.
- **T-50:** rerun manifest + real smoke; align the video proof narration with
  the actual state.
- **T-40:** record/publish <=5-minute video and verify it from an incognito tab.
- **T-20:** paste/review Consumer fields; submit and capture confirmation.
- **T-10:** paste Consumer confirmation into Brasil; review same URLs; submit.
- **T-5:** capture Brasil confirmation and verify both visible entries.
- **T-0 (23:00 BRT):** stop changes; retain 59 minutes only for user-owned
  platform recovery. The official prose cut remains 23:59 BRT.

## Hard blockers at handoff

- Human ownership/eligibility fields incomplete.
- `LIVE_URL`, `VIDEO_URL`, and `REPO_URL` incomplete.
- No public push, Node/Docker deployment or deployed HTTPS smoke.
- Current strict real proof not green.
- Both external confirmations pending.
- Docker engine verification pending on a host with a running daemon.

No external action was performed by the agent.
