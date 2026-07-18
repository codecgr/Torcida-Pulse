# High findings remediation evidence

Captured: 2026-07-18 06:31 BRT. Worktree:
`/tmp/txodds-release-hardening`; branch
`codex/txodds-release-hardening`; verified commit `79d1f40b2675852a2b1b890265a14dee38e88af6`.
Base: `codex/txodds-release` at `f8ff5ca`.

## Reproduction fact

The credential redirect regression was run before the fix:

```bash
npm test -- tests/txline-contract.test.ts -t "rejects redirects"
```

It failed with a cross-origin sink request containing the redacted fictional
`X-Api-Token: [fictional-test-token]` while `Authorization` was absent.
After `redirect: "error"` plus explicit 3xx rejection, the same command passed
and the sink request list was empty.

The batch regressions then failed on all supplied counterexamples: mismatched
fixture score/odds, top-level Participant, reversed proof values/context,
decreasing timestamps, first-goal baseline, odds-only 503, and timeout after
HTTP 200 headers. All are now green.

## Final reproducible gate

```bash
npm run verify
```

Result:

- Vitest: 11 files, 59/59 tests passed.
- Playwright managed Chromium: 46/46 tests passed in one worker.
- TypeScript/Vite/server build: passed.
- Security audit: passed public-tree/HEAD secret exclusions, browser bundle,
  pinned IDL, ignored local credentials, and high/critical production audit.
- Production smoke: passed CSP/noindex, `/api/live`, fail-closed `/api/ready`,
  explicit synthetic route, and fail-closed real route.
- `git diff --check`: passed.

## Build artifacts

- `dist/index.html`:
  `7128cd9372c52472aebdd0301a9324038a421980b9af099b9cc4753efd434851`
- `dist/assets/index-BhxLYxA6.css`:
  `574f28b9a9baa72ae264813c454467b2edc17cd8b93fb81e6fd2e4a607d65166`
- `dist/assets/index-DZneP0xw.js`:
  `0aa15297f982d58161d270b7a78c3e0932b761bfe2b5feac3483aeb54689d9f9`

## Covered behavior

- Redirect never follows with TxLINE credentials; all 3xx reject.
- Score/odds/proof bind to fixture, event timestamp, sequence, ordered stat keys,
  and exact score values before `.view()`.
- Top-level Participant 1/2 maps to the fixture's actual teams and raw identity.
- Playback uses stable controls and rAF partial updates; scrub, keyboard focus,
  rewind/rearm, in-card continuation, compact proof, and 320 px fold are tested.
- Odds failure degrades honestly; body timeout after 200 retries; completed
  parsing is required before 200 evidence.
- Single-flight, normalized TTL cache, prewarm, live/ready split, rate limit,
  judge access, noindex, and automatic real-data shutdown are tested.

## Not claimed

- No deployed HTTPS smoke was run because no submitted URL was provided.
- No live SSE or multi-match product was added; those remain licence-dependent
  roadmap items.
- No real TxLINE credential, proof blob, organizer message, or private judge
  code is recorded here.
