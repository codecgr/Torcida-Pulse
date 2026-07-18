# Release hardening handoff

Checkpoint: 2026-07-18 06:31 BRT.

## Integration

- Base release: `codex/txodds-release` / `f8ff5ca`.
- Hardened branch: `codex/txodds-release-hardening` / `79d1f40`.
- Commits:
  - `81d007a` — block TxLINE credential redirects.
  - `a82f395` — bind replay data/proof to the selected fixture and degrade odds.
  - `62d97ab` — judge gate, live/ready, single-flight/cache, rate/shutdown.
  - `1382074` — stable playback DOM, factual card, mobile/accessibility.
  - `79d1f40` — human/legal gates, deployment docs, smokes, contract.
- `npm run verify`: green (59 unit/integration, 46 E2E, security, smoke).

## Exact local commands

```bash
npm ci
npx playwright install chromium
npm run verify
```

Production real route additionally requires encrypted
`TXLINE_GUEST_JWT`, `TXLINE_API_TOKEN`, and `JUDGE_ACCESS_TOKEN`, plus public
`SOLANA_SIMULATION_PAYER` and an organizer-authorized ISO-8601
`REAL_DATA_DISABLE_AT`. See `docs/DEPLOYMENT.md`.

## Blocking user-owned actions

1. Complete every field in `docs/HUMAN_OWNERSHIP.md` and make a material final
   review/commit with the eligible participant's real Git identity.
2. Obtain written TxODDS direction for the exact real-data URL/video/screenshots.
   Without it, keep public deployment synthetic-only.
3. Provide/authorize the exact deployment account and HTTPS URL, then run:

   ```bash
   BASE_URL=https://submitted.example \
   JUDGE_ACCESS_TOKEN='<private judge code>' npm run smoke:deployed
   ```

4. Authorize public push, deployment, video publication, and separately submit
   the same project to Consumer and Brasil before the earlier deadline.

No external action above was performed by the agent.
