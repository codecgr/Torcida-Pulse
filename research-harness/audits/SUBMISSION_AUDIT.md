# SUBMISSION_AUDIT — Torcida Pulse global + Brasil

Audited 2026-07-18 16:39 BRT against verified implementation commit
`df6ed1d9df458e28927c5446b190c99ba664cd09`.

## Verdict

**PASS WITH LIMITATIONS for the local code/repository packet. NO-GO for final
submission until the user-owned P0 gates below are closed.**

Independence limitation: this audit was executed in the implementation context
because the user explicitly required solo work and no subagents. It is not
represented as the fresh independent certification normally required by the
project process. All claims below are tied to commands/artifacts rather than an
independence claim.

## P0 — must close before clicking Submit

1. **Three public URLs and deployed smoke are missing.** `LIVE_URL`,
   `VIDEO_URL`, and `REPO_URL` remain placeholders. No public repo push,
   Node/Docker deployment, TLS check or `smoke:deployed` result exists.
2. **Human ownership/eligibility is incomplete.** The natural-person leader,
   Brazil eligibility, material human review, terms decisions and human final
   commit remain blank in `docs/HUMAN_OWNERSHIP.md`.
3. **Strict real proof is currently red.** All five TxLINE calls returned 200
   and the replay facts were correct, but the proof timestamp did not match the
   selected event. The product truthfully emits `unavailable`. Video/form text
   must not say the proof is verified unless a later strict smoke is green.
4. **Data-display authority is unresolved.** Current public terms restrict
   making TxODDS Data available. Without written direction covering the exact
   URL/video/screenshots, keep public surfaces synthetic-only and label them.
5. **Double submission is not yet performed.** Consumer must be submitted
   first, then Brasil with the Consumer confirmation and identical three URLs.
   Both receipt records are still PENDING.

## P1 — close if the selected deployment path uses it

1. Docker client exists but the daemon/socket was absent, so the multi-stage
   image was not built/run on this host. Run the checkpoint's Docker commands on
   a working engine or deploy through a supported Node host and smoke that exact
   artifact.
2. The fixture manifest becomes rotation-due 2026-07-27T19:00:00Z. A recurring
   real smoke/owner response path is needed through judging; an expired fixture
   must not be extended in place.
3. The current private env has TxLINE credentials and a public payer but lacks
   production `JUDGE_ACCESS_TOKEN` and `REAL_DATA_DISABLE_AT`; do not enable the
   private real route until those are supplied correctly.

## Gates passed with evidence

### Functional product

- One Node server serves client and API; no static-hosting instruction remains.
- Spoiler-safe 20-second replay, play/pause/scrub/reveal, factual auto-pause,
  same-tuple before/after odds card, PT-BR/EN and explicit share output work.
- The event feed is linearly compressed from the recorded match clock and
  reveals throughout the replay; delivery telemetry cannot bunch it at the
  turning point. Loading has immediate honest context, proof internals are
  collapsed, and the final share/revive/card surface claims no mint or signup.
- Real and fictional paths are separate. Fictional data is permanently labeled
  `synthetic_unverified`; real failures do not silently replace the source.
- Complete backend deadline 12 seconds; abortable Solana RPC 3 seconds;
  browser `AbortSignal.timeout(12_000)`; fallback CTA at 3 seconds.
- Odds timeout keeps timeline; proof timeout becomes unavailable.

### TxLINE primacy and truthfulness

- Backend uses exactly five authenticated calls: fixture snapshot, historical
  scores, two odds snapshots and score validation.
- Both auth values stay server-side; redirects are rejected before follow;
  streamed JSON/SSE is capped/cancelled; raw responses and proof blobs are not
  returned, cached, logged or committed.
- Fixture, score, odds and proof context are cross-checked. A mismatched proof
  cannot turn the badge green, as the current real smoke demonstrates.
- No static snapshot or nonexistent live toggle is claimed. The source is a
  runtime normalized envelope; the only offline path is explicitly fictional.

### Deterministic quality

- Clean `npm ci`: PASS.
- Vitest: 68/68, 12 files.
- Playwright: 48/48, including full responsive/language/state axe matrix.
- Typecheck/build, manifest packet checks, security audit and production local
  smoke: PASS.
- Current build hashes are in `research-harness/tests/TEST_REPORT.md` and the
  canonical checkpoint.

### Public repository

- MIT project licence, upstream Apache-2.0 IDL licence and third-party notices
  present.
- `.gitignore` and `.dockerignore` exclude env files, secrets, keys, private
  receipts, build artifacts and internal agent material.
- Security gate checks current tree plus HEAD ancestry, browser bundle, pinned
  official IDL and high/critical production advisories.
- README contains Node/Docker run, endpoints, error/proof states, API behavior,
  verification and explicit new-project/human-ownership language.

### Current submission forms

Read-only inspection on 2026-07-18 found:

- Consumer: 12 fields (including live MVP, video, public repo, documentation,
  TxLINE experience and scope confirmation). Packet is field-complete.
- Brasil: 9 fields (including global-track confirmation, video, repo, technical
  summary, human members and Brazil KYC acknowledgement). Packet is
  field-complete.
- Both packet files define the same three URL slots. Automated check passes.
- Consumer-first instruction, explicit Brasil double-submission sentence and a
  two-receipt ledger are present.
- Brasil form displayed a 1-credit submission cost; spending/acknowledgement is
  human-owned.

### Consumer-track judging fit

- Fan accessibility/UX: mobile-first, PT-BR-first, understandable in one ticket
  and one turning-point story; no wallet or technical prerequisite.
- Responsiveness: progressive event reveal and server-backed replay; no claim of
  post-deadline live SSE.
- Originality/value: spoiler-safe authored turning-point replay plus honest
  provenance, not a generic score dashboard.
- Commercial path: licence-dependent sponsor/club/broadcaster white-label
  replay/share card, with free non-wagering fan access.
- Completeness: one small end-to-end product with backend, fallback, tests,
  deploy plan and <=5-minute script.

## Demo audit

The canonical 4:35 script covers the problem, working user flow, exact five
TxLINE calls, server-only integration, timeout/fallback behavior, provenance
truthfulness, language/mobile polish and double-submit close. It explicitly
forbids a green-proof claim while the strict smoke is red and forbids showing
secrets/raw data. No actual video exists yet, so the demo gate is **pending**.

## Submission decision

Do not submit the current placeholders. The local code is suitable for handoff;
the eligible human must close every P0, run the exact deployed gate, align the
video narration with the latest strict real smoke, then submit Consumer first
and Brasil second before the earlier prose deadline.
