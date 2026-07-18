# Mobile app redesign evidence — 2026-07-18

Captured: 2026-07-18 18:21 BRT. Worktree:
`/home/csg/Documentos/txodds-release`; branch `codex/txodds-release`.

## Frozen product contract

User story: a mainstream football fan who missed a match can open one compact
mobile experience, start a spoiler-safe 20-second replay, see it react to each
revealed event, pause automatically at the lead-changing moment, and inspect
the event feed or provenance without scrolling through a technical web page.

Acceptance conditions:

- the app shell is at most 430 px wide and keeps its primary picker CTA in the
  first 320/375/390 px mobile viewport;
- replay exposes exactly one active surface: `Ao vivo`, `Momentos`, or `Prova`;
- score, latest event, playhead, and pulse change in place without rebuilding
  the playback controls;
- the turning point replaces the live scoreboard at auto-pause, while the end
  state replaces the turning point with the final memory/action surface;
- fixed playback controls remain above a safe-area-aware bottom navigation;
- technical TxLINE/Solana details stay complete but live on the proof surface;
- PT-BR and English, keyboard navigation, reduced motion, 44 px targets,
  full Axe, failure states, and CSP remain green.

## Facts

- The prior vertically stacked web-page composition was replaced by a centered
  app shell with a compact picker, persistent mobile player, and three isolated
  replay surfaces.
- `Ao vivo` now renders a protected scoreboard plus an event-driven pulse ring
  and latest-event line. The SVG progress uses presentation attributes rather
  than inline CSS, so the production CSP remains strict.
- Auto-pause opens the pink turning-point experience directly. The same card
  retains score transition, comparable TxLINE signal movement, plain-language
  rarity, share/continue actions, and a direct proof affordance.
- `Momentos` contains only the progressively revealed event feed. `Prova`
  truthfully locks before the turning point and then exposes provenance,
  timestamps, PDA, endpoint status, exact tuple, and non-causality copy.
- The final state shows the final score and memory actions without forcing the
  fan through the turning-point card again.
- The Palpitei repository was used only as a read-only product-pattern
  reference for mobile hierarchy, card density, and bottom navigation. No
  source code, assets, copy, or identity were copied.
- Official read-only freeze recheck at 18:20 BRT still rendered the Brasil and
  Consumer listings `Open` / `Submit Now`, with 5 and 97 submissions.
- No login, terms acceptance, push, deployment, publication, organizer contact,
  spend, or submission occurred.

## Reproducible verification

Command:

```bash
npm run verify
```

Result:

- Vitest: 12 files, 68/68 tests passed.
- Replay manifest and double-submission packet consistency: passed.
- Playwright: 49/49 passed in one managed-Chromium worker.
- E2E matrix: 320, 375, and 1280 px; PT-BR and English; picker, initial,
  auto-pause, final, and error; full Axe, overflow, keyboard, history, fallback,
  CSP console, focus stability, safe reveal, and mobile surface isolation.
- Security audit: passed for public tree/history, browser bundle, ignored local
  credentials, IDL pin, and high/critical production audit.
- Local production smoke: passed for CSP/noindex, health split, explicit
  synthetic mode, and fail-closed real route.
- `git diff --check`: passed.

Ignored Playwright visual evidence:

- `test-results/app-picker-390.png`
- `test-results/app-live-390.png`
- `test-results/app-turning-390.png`
- `test-results/app-proof-390.png`

Build hashes:

| Artifact | SHA-256 |
| --- | --- |
| `dist/index.html` | `f7435e94fd6df1eada98aa2dc3e0209a461c43e850e24a5259730a87bd89da89` |
| `dist/assets/index-CYGf0XU-.js` | `7b2a1867935aabb860b96a86432471fbade417ba7d04bdea0aebf9f4e860915b` |
| `dist/assets/index-f-cHgzpK.css` | `39ca013609c1c66a7d3eef56730262aca6b39c2c4930489f45de01b1012292c0` |

## Inferences

- The product now reads as a purposeful mobile second-screen interaction, not
  a responsive landing page containing a feed.
- Separating fan emotion, revealed events, and technical trust reduces noise
  while making TxLINE centrality easier for a judge to inspect.
- The deterministic spoiler-safe auto-pause remains the clearest original
  interaction model and five-minute demo hook; adding unrelated features would
  weaken the submission at the current deadline.

## Unknowns and unchanged external gates

- The exact public HTTPS URL remains unknown, so `smoke:deployed` is pending.
- Real-data proof claims remain governed by the strict real smoke and must not
  be upgraded from unavailable to verified without a fresh green result.
- Commercial packaging and monetization are intentionally outside this UI
  checkpoint and should be addressed in the submission narrative separately.
