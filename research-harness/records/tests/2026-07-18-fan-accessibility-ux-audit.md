# Fan Accessibility & UX score-maximizer audit — 2026-07-18

Captured: 2026-07-18 18:49 BRT. Base: `codex/txodds-release` at
`55b9ba771186dc43b86959c22d5ee0fd244cca1e`.

## Criterion

Can a mainstream, non-technical sports fan understand the product, enjoy it,
and want to open it regularly? Every improvement below requires executable
behavior and regression evidence; unsupported decorative affordances are cut.

## Facts from the tested release

- The 390 px picker, spoiler protection, 20-second playback, automatic pause,
  PT-BR/English, accessibility matrix, TxLINE evidence, share API, and local
  save state already exist and are functional.
- Starting the experience requires `Entrar sem spoiler` and then a second
  `Reproduzir` click.
- Historical replay surfaces repeatedly say `Ao vivo` / `REPLAY AO VIVO`,
  which can be misread as a live match.
- At the automatic pause, the fixed player duplicates the card's Continue
  action and visually covers the lower portion of the climax.
- At completion, the fixed player covers the memory surface and retains two
  already-completed shortcuts.
- The ending advertises a disabled `Receber o próximo Momento da Virada`
  button although no subscription backend exists.
- Share fallback announces success only to assistive technology, and its DOM
  selector can share the auto-pause notice instead of the actual match story.
- Saving is one-way and underexposed; it cannot be undone.
- The fictional fallback's declared turning point is a 1–1 equalizer, but the
  fan-facing sentence says it completed a comeback.
- The signal percentages dominate the climax without an adjacent plain-language
  statement that they are a match pulse, not win probability.

## Frozen acceptance contract

1. One explicit tap from the picker starts the spoiler-safe replay.
2. Historical surfaces call themselves replay/game, never live coverage.
3. The climax has one primary continuation action and no overlapping player.
4. Final playback controls remain usable for rewinding but return to document
   flow; completed shortcuts disappear.
5. No disabled future-notification control remains. Save is reversible.
6. Sharing sends the factual turning-point story and shows visible success.
7. The fallback demonstrates a score-consistent completed comeback.
8. The turning card explains the TxLINE signal in fan language without calling
   it probability, prediction, or wagering advice.

## Inference

These changes improve comprehension, time-to-delight, trust, and repeat-use
credibility without adding a fake backend, wagering surface, or unproven data
claim.

## Implemented result

- The match-ticket CTA now starts the spoiler-safe replay in one explicit tap.
- Historical UI language is `Jogo` / `Replay em andamento`, then
  `Resultado revelado` / `Replay concluído`; no surface claims live coverage.
- The fixed player leaves the viewport at automatic pause, where the turning
  card owns the only Continue action. At completion it returns to document flow
  and hides already-completed shortcuts while retaining rewind/play.
- The turning card labels its values `Pulso antes/depois` and states `Pulso do
  jogo · não é chance de vitória` beside them.
- Share uses the factual turning-point narrative, not the auto-pause status, and
  displays visible success/failure feedback. Local save is reversible and its
  saved state is exposed on the match ticket without storing a fixture, team,
  score, event, odds, endpoint, or proof field.
- The non-functional next-notification button was removed.
- Expected protected/disabled real-data states now render a one-tap, explicitly
  fictional public-demo gateway; judge access remains a separate collapsed
  form and stays in `sessionStorage`.
- The fictional scenario now has a score-consistent comeback: Vento Sul leads
  0–1, Aurora equalizes 1–1, and Aurora's 84′ goal makes it 2–1 and owns the
  turning-point movement.
- Small judge-facing labels were increased while the 320 px layout remained
  overflow-free.

## Reproducible final evidence

Captured 2026-07-18 19:16 BRT in `/tmp/txodds-fan-ux`:

```bash
npm run verify
git diff --check
```

Result:

- Vitest: 12 files, 69/69 tests passed.
- Playwright: 51/51 passed in one managed-Chromium worker.
- Full unfiltered Axe and overflow matrix passed at 320/375/1280 px, PT-BR/EN,
  picker/initial/auto-pause/final/error, plus the PT-BR/EN public gateway.
- One-tap start, correct share payload, visible share feedback, reversible save,
  non-overlapping climax, static final player, hidden completed shortcuts,
  truthful completion labels, friendly public gateway, judge access and the
  corrected fictional comeback all have executable regressions.
- Replay manifest, submission-packet consistency, TypeScript/client/server
  build, public-tree/history security audit and local production smoke passed.
- `git diff --check`: passed.

The same `npm run verify` gate was repeated after fast-forward integration in
`/home/csg/Documentos/txodds-release` at 19:20 BRT: 69/69 Vitest, 51/51
Playwright, packet/manifest checks, build, security and production smoke all
passed again with the same three artifact hashes.

Build artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `dist/index.html` | `5b579594b18221aa8a8f856ee97acca944e0062e19a838be2210a748ec80897e` |
| `dist/assets/index-BUi3yceN.css` | `e4f0f369b3543c3d0b094bed20d579fb12ed20ec2fb584d71ba2610e0b083a26` |
| `dist/assets/index-nq5WLkbu.js` | `043010a3558740e8a0c3dfbf8b12eea79f1245bc8db600ad32d38181be56ac16` |

Ignored Playwright visual evidence:

- `test-results/app-picker-390.png`
- `test-results/app-turning-390.png`
- `test-results/e2e-ending-375.png`
- `test-results/app-public-gateway-390.png`

## Remaining external limitation

No `LIVE_URL` was supplied, so the exact HTTPS deployment still requires
`BASE_URL=https://… npm run smoke:deployed`. No public push, deployment, video,
terms acceptance, spend, account action, or submission was performed.
