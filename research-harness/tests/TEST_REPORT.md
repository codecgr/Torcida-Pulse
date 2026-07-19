# TEST_REPORT — Torcida Pulse post-fix release

Frozen evidence: 2026-07-18 16:39 BRT. Verified implementation commit:
`df6ed1d9df458e28927c5446b190c99ba664cd09`.

## Result

**Deterministic local gate PASS: 68/68 Vitest + 48/48 Playwright E2E.**

External gates are reported separately and are not converted into passes:
Docker daemon unavailable, no deployed URL, and strict real proof currently
unavailable because its timestamp did not match the selected event.

## Environment

- Worktree: `/tmp/txodds-release-hardening`
- Branch: `codecgr/txodds-release-hardening`
- OS/container host: Linux
- Node: `v22.22.2`
- npm: `10.9.7`
- Clean install: `npm ci` installed 125 locked packages in 0.981 s.
- Dependency audit: five moderate advisories in the documented Anchor/Solana
  chain; no high/critical production advisory.

## Exact commands and outcomes

```bash
npm ci
npm run verify
```

`npm run verify` executes, in order:

```bash
npm test
npm run check:replay-manifest
npm run check:submission-packets
npm run test:e2e
npm run test:security
npm run smoke
```

Observed outcomes:

- Vitest: 12 files, 68 tests passed.
- Replay manifest: GREEN for fixture `18241006`, epoch day `20649`;
  `rotateBefore=2026-07-27T19:00:00Z`,
  `historicalEligibleUntil=2026-07-29T19:00:00Z`.
- Submission packets: 12 Consumer fields, 9 Brasil fields, identical three-URL
  set, Global-first order and explicit Brasil declaration all passed.
- Build: TypeScript client/server and Vite passed.
- Playwright: 48 tests passed in one worker. Coverage includes the 30-state
  320/375/1280 px x PT-BR/EN x picker/initial/auto-pause/final/error matrix,
  full axe scans, keyboard/focus, no horizontal overflow, history, stale-request
  suppression, visible pre-turning feed rows, contextual loading, collapsed
  proof details, final continuity/restart, and the fallback becoming available
  after three seconds.
- Security: current tree and Git ancestry secret exclusions, `.dockerignore`,
  browser bundle, official IDL hash and high/critical production audit passed.
- Local production smoke: page/CSP/noindex, `/api/live`, fail-closed
  `/api/ready`, explicit `/api/demo`, and credential-closed real route passed.

## Timeout and degradation regressions

- `REPLAY_TOTAL_TIMEOUT_MS === 12_000` and an initial blackhole request is
  actually aborted at the one total replay deadline without a second retry.
- `SOLANA_RPC_TIMEOUT_MS === 3_000`; the custom web3 fetch aborts the underlying
  fetch, not only a wrapper promise.
- Browser source is regression-checked for `AbortSignal.timeout(12_000)`.
- Proof RPC/endpoint timeout maps to provenance `unavailable` with
  `reason: "proof_timeout"`.
- One or both odds timeouts leave normalized score events usable and set
  `turningPointReason: "odds_unavailable"`.
- If the total deadline expires during odds, the already-normalized timeline is
  returned and proof is unavailable.
- At three seconds, a keyboard-accessible labeled fictional CTA appears; if the
  user chooses it, a late real response cannot replace the synthetic envelope.

## Other covered behavior

- Five authenticated calls, two server-only auth headers, redirect rejection,
  finite SSE historical framing, streamed size cap and body cancellation.
- Duplicate, correction, same-sequence conflict, reordered/decreasing timestamp,
  missing field, fixture mismatch and top-level participant identity handling.
- UTC/BRT boundary and browser IANA timezone rendering.
- Exact same-tuple odds comparison and no invented turning point.
- Exact fixture/seq/timestamp/statKeys/score proof argument binding.
- Read-only devnet payer guard; no private key/signature/send path.
- Judge header stays in `sessionStorage` and is sent only to the same-origin real
  route; production access shutdown/rate/cache/single-flight behavior.
- Synthetic fixture is permanently labeled `synthetic_unverified`.
- A regression fixture reproduces the real pre-fix bunching (kickoff at
  19.053s). Match minutes now map by `minute / finalMinute * 20s`; the inverse
  ratio recovers every original minute to floating-point precision.

## Build outputs

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/index.html` | 1,648 | `e344358bc11dd9e0af94700b3c635aab888344485f7c67246e64ad3902f4f081` |
| `dist/assets/index-BIwh50LK.js` | 37,457 | `c97b5129872e0bda2ce08fe2d6e8a06d0401719052497447473e7a9b92fa71eb` |
| `dist/assets/index-DwAyuUsD.css` | 30,702 | `7a8d8795f1e4c93fb69c97624b9e7f8fed462f76960cbca8c600e196dd33cc9c` |

Vite gzip: HTML 0.61 kB, JavaScript 12.59 kB, CSS 7.22 kB.

## Real and external smokes

Sanitized read-only command (credentials loaded from an ignored mode-600 file;
no value printed):

```bash
node --env-file=/absolute/private/.env scripts/real-txline-smoke.mjs
```

Observed:

- five endpoint statuses: HTTP 200;
- source `real_txline`, fixture `18241006`, 10 events;
- turning point seq 871, minute 91, score 1–2;
- comparable `Pct` 12.989 -> 88.652, delta 75.663 pp;
- strict result: **NOT GREEN**;
- provenance: `unavailable`, reason `proof_shape_unavailable`;
- safe diagnostic: `Proof timestamp does not match the selected event timestamp.`
- normalized-envelope hash for the final diagnostic run:
  `c66d306565cbc9109e7dc3f978815e06ae52ac71b827a0d98a328a216d3bfbf3`.

The hash includes fetch/check timestamps and therefore changes between runs; it
identifies that captured smoke output, not an immutable recorded replay.

Not run/claimed:

- `BASE_URL=https://... npm run smoke:deployed`: no submitted HTTPS URL.
- `npm run smoke:real:browser:env`: not claimed in this pass; the privileged
  Chromium launch was refused by the execution environment's usage limit.
  Deterministic Chromium coverage remained green at 320/375/1280 px.
- Docker build/run: Docker client `29.6.2` exists, but the daemon socket was
  absent. The exact commands are in the canonical checkpoint.

## Evidence integrity

- `package-lock.json` SHA-256:
  `7e6148ce368b0090b0c5cfd61437abdcc79a8ab8541466929b967f14c9760272`.
- `Dockerfile` SHA-256:
  `9dba59dfff59f52969704beafe25c3d84a2fcfb1a89ab7fee59306b7b7789185`.
- No raw TxLINE payload, proof blob, token, JWT, judge code, wallet key or
  private submission receipt is in this report or repository.
