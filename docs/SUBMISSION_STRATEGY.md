# Submission strategy — no deployment

Decided 2026-07-19, two days before the submission deadline, after starting the
project on 17 July 2026. Given the short build window and the TxODDS
data-display restriction, the entry will **not** include a hosted HTTPS site.

## What is being submitted

| Artifact | Field | Notes |
| --- | --- | --- |
| Public GitHub repository | `LIVE_URL` + `REPO_URL` | Inspectable source, build, `npm run verify` evidence. Same value in both packets. |
| Working demo video (<= 5:00) | `VIDEO_URL` | Locally captured spoiler-safe 20s catch-up + factual Turning Point auto-pause. Public/unlisted Loom or YouTube. |

## Why no deployment

- A live HTTPS URL is hard to reconcile with the terms' Data-display
  restriction; real data is only shown behind a private judge code.
- The build window was ~2 days; a correct, secret-safe deployment plus a green
  strict real smoke was not achievable in time.
- A public repo + recorded video is better than submitting nothing and still
  lets reviewers run the full experience locally.

## Honesty constraints

- The video must **not** claim Solana proof as verified. Current strict-gate
  status is `unavailable` / `proof_shape_unavailable` (see `docs/API_FEEDBACK.md`).
- No public screenshot/video shows the real-data route; it stays behind the
  private judge code in the code.
- `LIVE_URL`/`REPO_URL` must be the real public repository, never an invented
  deployment URL. If the repo is not public at submit time, leave them
  `[A DEFINIR]` and record it in `docs/HUMAN_OWNERSHIP.md`.

## Order of operations (human)

1. Fill `docs/HUMAN_OWNERSHIP.md` (eligibility, final human commit, repo decision).
2. Make the repository public; confirm `LIVE_URL`/`REPO_URL`.
3. Record and verify the demo video (`VIDEO_URL`, <= 5:00, shows auto-pause).
4. Submit Consumer first (`docs/SUBMISSION_GLOBAL.md`), capture confirmation.
5. Submit Brasil with the double-submission sentence (`docs/SUBMISSION_BRASIL.md`).
6. Save both receipts in `research-harness/records/submissions/`.
