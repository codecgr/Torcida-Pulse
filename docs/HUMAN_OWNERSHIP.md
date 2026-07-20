# Human ownership gate

Torcida Pulse was built during the 2026 TxODDS World Cup hackathon period. The
current official terms require a natural person to own, materially control, and
submit the entry. An automated agent cannot supply or attest a human identity.

Complete every field before public push or either submission:

- Human team leader (legal/display name): **Cícero Grunevald**
- Superteam account used for both entries: **@codecgr**
- Brazil eligibility confirmed by the participant: **yes — 2026-07-19**
- Age/jurisdiction/organizer exclusions reviewed: **yes — 2026-07-19**
- Material human review performed: **features/code/demo/docs**
- Human-authored final commit hash: **82c4724193a9388c55f19d717c887f6856c66b2d** (HEAD of `codecgr/txodds-release`, pushed to `origin/main` on 2026-07-19)
- TxODDS written data-display permission reference, or synthetic-only decision:
  **No public deployment. Entry delivered as public GitHub repo + locally
  captured demo video; real-data route stays behind the private judge code and
  is not shown in public video/screenshots. Store no private correspondence in
  the public repo.**

## Git identity and branch naming (updated 2026-07-19)

- Author identity for the final human commit: **codecgr <codelyst.dev@gmail.com>**
  (set locally with `git config user.name codecgr` and
  `git config user.email codelyst.dev@gmail.com`).
- Branch prefix policy: all agent-created branches used the `codex/` prefix.
  They are renamed to the human owner prefix **`codecgr/`** so the public
  history reads as human-owned. The current integration branch is
  `codecgr/txodds-release`.
- The `codex/` -> `codecgr/` rename must be performed with write access to the
  repository's `.git` (the sandbox mount is read-only). From a writable shell:

  ```sh
  git branch -m codex/txodds-release           codecgr/txodds-release
  git branch -m codex/txodds-director-main     codecgr/txodds-director-main
  git branch -m codex/txodds-builder-torcida   codecgr/txodds-builder-torcida
  git branch -m codex/txodds-fan-ux            codecgr/txodds-fan-ux
  git branch -m codex/txodds-fanux-levitate    codecgr/txodds-fanux-levitate
  git branch -m codex/txodds-public-final      codecgr/txodds-public-final
  git branch -m codex/txodds-public-wow        codecgr/txodds-public-wow
  git branch -m codex/txodds-recovery-p0       codecgr/txodds-recovery-p0
  git branch -m codex/txodds-release-hardening codecgr/txodds-release-hardening
  git branch -m codex/txodds-release-prep      codecgr/txodds-release-prep
  git branch -m codex/txodds-sol-recovery      codecgr/txodds-sol-recovery
  git branch -m codex/txodds-submission-clean  codecgr/txodds-submission-clean
  git branch -m codex/txodds-visual-wow        codecgr/txodds-visual-wow
  ```

  Then move/refresh the local worktrees that point at the old `codex/` names
  (their checkouts keep the old branch ref until updated). Prunable temp
  worktrees in `/tmp` can be removed with `git worktree remove --force`.

## Submission plan (updated 2026-07-19)

There is **no hosted HTTPS deployment**. The deliverables are:

1. **Public GitHub repository** — the inspectable artifact; used as `LIVE_URL`
   and `REPO_URL` in both submission packets.
2. **Working demo video** (public/unlisted, <= 5:00) — the spoiler-safe
   20-second catch-up running locally, including the factual Turning Point
   auto-pause; used as `VIDEO_URL`.

The video must not claim Solana proof as verified unless a green strict smoke
was recorded first; otherwise it states provenance `unavailable`.

The participant should make a final material review and commit using their real
Git identity (codecgr <codelyst.dev@gmail.com>) without rewriting or erasing
prior agent-authored commits. The same eligible human account must submit the
Consumer entry and Brasil listing.
