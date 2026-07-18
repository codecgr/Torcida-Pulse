# TEST_REPORT — Torcida Pulse post-fix release

Frozen evidence: 2026-07-18 07:14 BRT. Verified implementation commit:
`564b5586c5126f3ecfc1b6f192aef360b6bf4a8a`.

## Result

**Deterministic local gate PASS: 67/67 Vitest + 47/47 Playwright E2E.**

External gates are reported separately and are not converted into passes:
Docker daemon unavailable, no deployed URL, and strict real proof currently
unavailable because its timestamp did not match the selected event.

## Environment

- Worktree: `/tmp/txodds-release-hardening`
- Branch: `codex/txodds-release-hardening`
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

- Vitest: 12 files, 67 tests passed.
- Replay manifest: GREEN for fixture `18241006`, epoch day `20649`;
  `rotateBefore=2026-07-27T19:00:00Z`,
  `historicalEligibleUntil=2026-07-29T19:00:00Z`.
- Submission packets: 12 Consumer fields, 9 Brasil fields, identical three-URL
  set, Global-first order and explicit Brasil declaration all passed.
- Build: TypeScript client/server and Vite passed.
- Playwright: 47 tests passed in one worker. Coverage includes the 30-state
  320/375/1280 px x PT-BR/EN x picker/initial/auto-pause/final/error matrix,
  full axe scans, keyboard/focus, no horizontal overflow, history, stale-request
  suppression, and the fallback becoming available after three seconds.
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

## Build outputs

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/index.html` | 1,648 | `260bc45790c03bbb49ea4e7ee037df7ecd4cdc6647822938e5c1f4ab09703327` |
| `dist/assets/index-CzPSqBMM.js` | 34,311 | `03bf65d147b7db1d05eabe1077c007db2b7c547695058e25ca69d41c972bc2d7` |
| `dist/assets/index-DdlG2TPA.css` | 26,913 | `613aa98113b4ea843ea7e4b3c829a29362e21676017a5478e942d773cf93f70c` |

Vite gzip: HTML 0.61 kB, JavaScript 11.77 kB, CSS 6.51 kB.

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
  `08f4dbe20c7ee1ef4684e3087eeb33bfc88b4e020d0dee3b7255bab9a36b82d6`.

The hash includes fetch/check timestamps and therefore changes between runs; it
identifies that captured smoke output, not an immutable recorded replay.

Not run/claimed:

- `BASE_URL=https://... npm run smoke:deployed`: no submitted HTTPS URL.
- `npm run smoke:real:browser:env`: strict proof is not green and the existing
  private env lacks production judge/shutdown values.
- Docker build/run: Docker client `29.6.2` exists, but the daemon socket was
  absent. The exact commands are in the canonical checkpoint.

## Evidence integrity

- `package-lock.json` SHA-256:
  `7e6148ce368b0090b0c5cfd61437abdcc79a8ab8541466929b967f14c9760272`.
- `Dockerfile` SHA-256:
  `9dba59dfff59f52969704beafe25c3d84a2fcfb1a89ab7fee59306b7b7789185`.
- No raw TxLINE payload, proof blob, token, JWT, judge code, wallet key or
  private submission receipt is in this report or repository.

