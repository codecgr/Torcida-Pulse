# Deployment runbook

Torcida Pulse is a Node web service, not a static Vite site. A static Pages/
Netlify upload would break the secure backend and must not be used.

## Host contract

- Node `^20.19.0` or `>=22.12.0` (the `.nvmrc` path is 22.12.0), or the included
  `Dockerfile`.
- Build: `npm ci && npm run build`.
- Start: `npm start`.
- Health: `GET /api/health`.
- Host injects `PORT`; server binds on all interfaces.
- Persistent disk is unnecessary and should not be enabled.

## Secrets and public values

Set through the host's encrypted secret manager:

- `TXLINE_GUEST_JWT` — secret.
- `TXLINE_API_TOKEN` — secret.

Set as a normal environment value:

- `SOLANA_SIMULATION_PAYER` — funded devnet public address only.
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
is still within the documented historical window.

## Post-deploy judge smoke

Run the automated gate against the exact URL that will be submitted:

```bash
BASE_URL=https://your-real-domain.example npm run smoke:deployed
```

It requires valid TLS and host secrets, then checks readiness, CSP, normalized
replay schema, all five endpoint evidence rows, verified proof/PDA/timestamps,
the Explorer devnet link, a 375 px managed-Chromium flow, console/request
failures, and secret/proof markers in HTML, assets, API responses and rendered
DOM. It fails closed if `BASE_URL` is not HTTPS.

Use a fresh incognito browser with no local storage or login:

1. `/api/health` is 200 and says credentials configured; no values appear.
2. Root loads without wallet/account/token prompts.
3. Default banner says real TxLINE; no automatic fictional fallback.
4. Initial replay DOM contains no score/result/future event/market/proof detail.
5. Play auto-pauses at the turning point.
6. Exactly five backend evidence rows appear.
7. Badge is green only with state `verified`.
8. Reveal finishes; EN toggle works; 375 px has no horizontal overflow.
9. Browser Network response contains normalized fields, never auth/proof blobs.
10. Server logs contain no header, token, proof or raw payload.

If any check fails, fix it before presenting the URL to judges.

## Credential lifecycle

- Rotate immediately if any secret appears in a shell transcript, host build log,
  screenshot, video, Git object or browser response.
- Recheck expiration through the official activation flow before judging.
- Revoke/remove host secrets and disable the data route when the hackathon data
  licence ends, unless TxODDS provides written continued authorization.
