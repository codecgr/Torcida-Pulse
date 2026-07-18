# Project state

Status at 2026-07-18 19:16 BRT: **FAN UX RELEASE GREEN; EXTERNAL SUBMISSION
GATES OPEN**.

## Frozen implementation

- Product: Torcida Pulse, a PT-BR/EN, mobile-first, non-wagering TxLINE match
  replay with spoiler-safe progressive reveal, one factual turning-point card,
  and truthful Solana devnet provenance.
- Mobile experience: a maximum-430 px app shell with a compact protected-match
  picker, one-tap autoplay, fixed playback dock, safe-area bottom navigation,
  and exactly one active `Jogo`, `Momentos`, or `Prova` surface. Auto-pause
  removes the dock and hands the viewport to one turning-point story;
  completion uses truthful final labels and returns the player to document flow.
- Fan language: the card labels the TxLINE values as a match pulse—not win
  probability. Sharing sends the factual story with visible feedback; local
  save is reversible; no disabled notification/signup action remains.
- Public-safe entry: expected protected/disabled real-data states offer an
  explicitly fictional demo in one tap instead of a technical dead end. Private
  judge access stays collapsed, in `sessionStorage`, and same-origin only.
- Verified fan-UX commit: `bd07dfb857f9091fc385ace09ac30eb0d6c017dd`.
- Integration branch and verified worktree: `codex/txodds-release` at
  `/home/csg/Documentos/txodds-release`, fast-forwarded from the isolated UX
  branch based directly on the user-tested release commit `55b9ba7`.
- Runtime: one Node service serves both the Vite client and same-origin API.
  **Static hosting is unsupported.** Use Node or the multi-stage Dockerfile.
- The complete real replay is capped at 12 seconds. Solana RPC fetches are
  abortable at three seconds. Odds timeout preserves the score timeline; proof
  timeout is `unavailable`; the browser uses `AbortSignal.timeout(12_000)` and
  exposes the labeled fictional fallback after three seconds.
- Match-clock minutes are linearly compressed into 20 seconds; delivery
  sequence/timestamps no longer bunch the real feed at the turning point. The
  inverse playback ratio recovers each source minute.
- Loading renders promise, selected fixture and a disabled preparing CTA
  immediately; an in-flight real request exposes the labeled demo after three
  seconds. Proof internals are collapsed behind “Ver prova”; the ending offers
  share/replay/reversible local save plus an explicitly non-minted visual card.
  No signup, mint or collection backend is claimed.
- No normalized real TxLINE envelope was captured or committed. The active
  fixture and epoch are owned by `config/replay-manifest.json`. Its gate turns
  red at 2026-07-27T19:00:00Z, two days before historical eligibility ends at
  2026-07-29T19:00:00Z.
- Active Codex monitor `txodds-replay-judge-monitor` runs daily at 09:00 local
  time through the 2026-07-29 15:00 UTC winner-announcement time. It works solo,
  sanitizes the strict real smoke, never pushes/deploys/submits, and may commit
  a local manifest rotation only after every deterministic and strict real gate
  is green.

## Reproducible local result

- Clean `npm ci`: 125 packages installed from lockfile under Node `v22.22.2`,
  npm `10.9.7`; five moderate advisories remain in the documented
  Anchor/Solana chain, with no high/critical production advisory.
- `npm run verify`: PASS at 19:16 BRT.
  - Vitest: 12 files, 69/69 tests.
  - Playwright: 51/51 E2E in one managed-Chromium worker.
  - Manifest and submission-packet consistency gates: PASS.
  - TypeScript/client/server build: PASS.
  - Public-tree/history secret scan, IDL pin, browser scan and production audit:
    PASS.
  - Local production server smoke: PASS.
- Dockerfile is present and secret-safe via `.dockerignore`, but a container
  build was not executed because the local Docker daemon/socket was absent.
- No deployed HTTPS smoke exists because `LIVE_URL` has not been supplied.

The requested older “35 tests + E2E” count does not describe this branch. The
current post-fix evidence is 69 unit/integration tests plus 51 E2E tests; no
tests were removed to match a stale number.

## Current real-data observation

The sanitized real smoke after the timeout/manifest fixes reached all five
TxLINE calls with HTTP 200 and returned fixture `18241006`, ten curated events,
the 91′ 1–2 lead reversal and the 12.989% -> 88.652% comparable tuple movement.
The real match ended at 101′; proportional playback places 36′ at
7.128712…s, 45′ at 8.910891…s, 91′ at 18.019801…s and 101′ at 20s.
The strict gate remained red because the current validation response's proof
timestamp did not match the selected event timestamp. The application correctly
reported provenance `unavailable` / `proof_shape_unavailable`; it did not claim
verification. This must be re-smoked before recording a green proof in the
video or submission.

## Submission packets

- Current Consumer form, all 12 fields: `docs/SUBMISSION_GLOBAL.md`.
- Current Brasil form, all 9 fields: `docs/SUBMISSION_BRASIL.md`.
- Both packets share exactly `LIVE_URL`, `VIDEO_URL`, and `REPO_URL`; an
  automated check prevents drift.
- Required order: submit Consumer first, capture its confirmation, then submit
  the identical project to Brasil with the explicit double-submission sentence.
- Confirmation ledger: `research-harness/records/submissions/CONFIRMATIONS.md`.

## User-owned blockers

1. Complete `docs/HUMAN_OWNERSHIP.md` with the eligible natural-person leader,
   Brasil eligibility, material review, and human-authored final commit.
2. Supply one public HTTPS `LIVE_URL`, public/unlisted <=5-minute `VIDEO_URL`,
   and public `REPO_URL`; put the identical values in both packets.
3. Obtain/record the applicable TxODDS data-display direction. Without it,
   keep the public deployment synthetic-only and do not show normalized real
   data in public screenshots/video.
4. Run the strict real smoke again; do not describe Solana proof as verified
   unless it is green. Run the exact deployed HTTPS smoke against `LIVE_URL`.
5. Read/accept terms personally and submit Consumer first, then Brasil, before
   the controlling 2026-07-18 23:59 BRT prose deadline. Save both receipts.

No account, terms, public push, deployment, video publication, organizer
contact, credit spend, KYC, or submission was performed by the agent.
