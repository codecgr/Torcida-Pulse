# TxLINE API feedback — authenticated Devnet observations

Prepared 2026-07-18 after an authenticated five-endpoint run. No raw response,
header, credential or proof blob was stored in this repository.

## What worked

- The two-header auth boundary maps cleanly to a server-only adapter.
- Fixture → historical scores → two as-of odds states → score proof is a compact,
  understandable consumer demo chain.
- Participant-nested totals remove ambiguity between the two teams.
- `statKeys=1,2` and positional V2 strategies provide a precise score proof.
- The official devnet IDL exposes a read-only `.view()` path; no custom program
  or end-user wallet is needed.
- `Pct` can be treated as an opaque numeric signal while preserving the exact
  returned market tuple, avoiding undocumented `Prices` scaling assumptions.
- Fixture `18241006`, historical scores, two as-of odds snapshots and the V2
  stat proof all returned HTTP 200 in one real replay.
- `Stats[1]`/`Stats[2]` matched both returned proof positions at the observed
  91′ lead reversal to 1–2, and `validateStatV2.view()` returned true for
  sequence `871` against epoch day `20649`.
- The free tier genuinely charged zero TxL. The Devnet subscription used only
  normal Devnet SOL fee/account rent.

## Friction observed

- Activation requires a guest JWT, an on-chain subscription, an exact wallet
  signature and an activated API token; a guest JWT alone cannot call data.
- The API reference and generated fetch example describe
  `/scores/historical/{fixtureId}` as a JSON array, but the authenticated Devnet
  response was a finite `text/event-stream` containing 964 JSON `data:` frames.
- Live history used uppercase, sparse participant-nested `Score` plus a complete
  `Stats` map. Treating sparse `Score.*.Total.Goals` as the full state produced
  the wrong proof predicate; keys `1` and `2` were the reliable complete totals.
- All observed odds rows had `MarketPeriod: null`, and one snapshot row also had
  `MarketParameters: null`. Explicit nulls need documented tuple semantics;
  Torcida Pulse compares null only with identical null and rejects absence.
- The current Anchor package does not export `anchor.BN`, although patterns in
  older examples commonly rely on it. Importing `BN` directly was required.
- Historical scores accept only fixtures started between six hours and two
  weeks ago. The selected fixture started at 2026-07-15T19:00:00Z, so its route
  expires at 2026-07-29T19:00:00Z—during the judging day.
- Odds `Prices` scaling is not documented clearly enough for safe display.
- A proof HTTP response is easy to mistake for verification; documentation
  should label receipt and successful on-chain simulation as separate states.
- Read-only Anchor simulation still needs a valid funded public fee-payer
  account in the transaction message, even though no signature is verified.
- Listing deadlines expose conflicting prose and structured timestamps.
- Data-display restrictions are difficult to reconcile with the requirement for
  a public, judge-testable data product.

## Safe deployment response to the data-display conflict

No organizer permission is assumed. The public route serves only the visibly
labeled fictional scenario and sends `noindex`. The normalized real route is
selected by `config/replay-manifest.json`, requires a private judge code in production, uses a
process-wide single-flight/TTL cache and rate limit, and refuses to start its
display window without `REAL_DATA_DISABLE_AT`. It returns 410 after that cutoff.

The manifest records the six-hour/two-week eligibility bounds and fails
`npm run check:replay-manifest` at `rotateBefore` (2026-07-27T19:00:00Z), two
days before expiry. `smoke:real` and the real browser smoke both run that gate
and read their fixture/expected turning point from the same manifest. Rotation
therefore changes one reviewed file instead of leaving IDs or epochs hidden in
server/browser scripts. No TxLINE replay was captured or committed.

Reliability is bounded independently of fixture rotation: the complete backend
replay aborts at 12 seconds, each Solana RPC fetch aborts at three seconds,
proof timeout maps to `unavailable`, odds timeout preserves the timeline, and
the browser exposes the labeled fictional fallback after three seconds while
its own request is capped with `AbortSignal.timeout(12_000)`.

Before publishing any real-data URL, screenshot, or video, the human participant
must obtain written TxODDS confirmation covering those exact normalized
surfaces. Without confirmation, submit/demo the synthetic public route and
provide real integration evidence only through a privately authorized judging
path consistent with the organizer's instructions.

## Reproducible result

`npm run smoke:real:env` returned:

- five HTTP 200 endpoint statuses;
- ten curated real match milestones;
- a 75.663 percentage-point comparable movement around the selected factual
  lead-reversing goal; and
- provenance `verified` with epoch day `20649`.

The corresponding real production-browser smoke passed at 375×812 with an
authored auto-pause frame, embedded playhead score, the verified badge, five
visible endpoint rows, no overflow or serious/critical axe violations. Separate
production E2E passed at 320 px, desktop and in both languages; no browser
console errors were observed.
