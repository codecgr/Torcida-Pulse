# Deployment runbook

Torcida Pulse is a Node web service, not a static Vite site. A static Pages/
Netlify upload would break the secure backend and must not be used.

## Host contract

- Node `^20.19.0` or `>=22.12.0` (the `.nvmrc` path is 22.12.0), or the included
  `Dockerfile`.
- Build: `npm ci && npm run build`.
- Start: `npm start`.
- Liveness: `GET /api/live` (process only).
- Readiness: `GET /api/ready` (503 until prewarmed real replay is usable).
- Compatibility diagnostics: `GET /api/health`.
- Host injects `PORT`; server binds on all interfaces.
- Persistent disk is unnecessary and should not be enabled.

## Secrets and public values

Set through the host's encrypted secret manager:

- `TXLINE_GUEST_JWT` — secret.
- `TXLINE_API_TOKEN` — secret.
- `JUDGE_ACCESS_TOKEN` — random private code (minimum 16 characters). Give it
  only to judges through private submission notes, never in the URL/repository.

Set as a normal environment value:

- `SOLANA_SIMULATION_PAYER` — funded devnet public address only.
- `REAL_DATA_DISABLE_AT` — mandatory ISO-8601 UTC cutoff authorized by TxODDS.
- Optional bounded controls: `REPLAY_CACHE_TTL_MS`,
  `REPLAY_RATE_LIMIT_MAX`, `REPLAY_RATE_LIMIT_WINDOW_MS`.
- `NODE_ENV=production`.

Never deploy `.env`, a wallet JSON, seed phrase, private key, activation
signature, raw proof or captured TxLINE response. Never use `VITE_` for secrets.

## Pre-deploy

```bash
npm ci
npx playwright install --with-deps chromium
npm run verify
npm run smoke:real:env
npm run smoke:real:browser:env
git status --short
```

Both real smokes must be green before deployment. Confirm the selected fixture
is still within the documented historical window. Obtain written TxODDS
confirmation covering the exact normalized judge URL, screenshots, and video.
If that confirmation does not exist, deploy only the synthetic public route;
do not expose the real route or represent legal ambiguity as resolved.

## Post-deploy judge smoke

Run the automated gate against the exact URL that will be submitted:

```bash
BASE_URL=https://your-real-domain.example \
JUDGE_ACCESS_TOKEN='<same private host secret>' npm run smoke:deployed
```

It requires valid TLS and host secrets, then checks readiness, CSP, normalized
replay schema, all five endpoint evidence rows, verified proof/PDA/timestamps,
the Explorer devnet link, a 375 px managed-Chromium flow, console/request
failures, and secret/proof markers in HTML, assets, API responses and rendered
DOM. It fails closed if `BASE_URL` is not HTTPS.

Use a fresh incognito browser with no local storage or login. Enter the private
judge code in the app when requested; never append it to the URL:

1. `/api/live` is 200; `/api/ready` is 200 only after prewarm.
2. `/api/health` says credentials configured; no values appear.
3. Root requests the private judge code and also offers the explicitly labeled
   fictional public path; no wallet/account/TxLINE credential prompt exists.
4. After the judge code, the banner says real TxLINE; no automatic fictional
   fallback.
5. Initial replay DOM contains no score/result/future event/market/proof detail.
6. Play auto-pauses at the turning point and focuses the in-card continue button.
7. Exactly five backend evidence rows appear.
8. Badge is green only with state `verified`.
9. Reveal finishes; EN toggle works; 320/375 px have no horizontal overflow.
10. Browser Network response contains normalized fields, never TxLINE
    auth/proof blobs.
11. Server logs contain no header, token, proof or raw payload.
12. `X-Robots-Tag` and the HTML robots meta both say noindex/nofollow/noarchive.

If any check fails, fix it before presenting the URL to judges.

## Credential lifecycle

- Rotate immediately if any secret appears in a shell transcript, host build log,
  screenshot, video, Git object or browser response.
- Recheck expiration through the official activation flow before judging.
- Revoke/remove host secrets and disable the data route when the hackathon data
  licence ends, unless TxODDS provides written continued authorization.
- Confirm the route returns 410 at/after `REAL_DATA_DISABLE_AT`; do not extend
  that value without new written permission.
