# Critical remediation start

Captured: 2026-07-18 06:45 BRT (`America/Sao_Paulo`). The internal freeze at
23:00 BRT was 16 h 15 min away; the controlling Brasil prose deadline at 23:59
BRT was 17 h 14 min away.

## Baseline

- Source branch/worktree: `codecgr/txodds-release` at `423ce0234753cbeff76a5b7e4b0a16ab5c5fe061`.
- Isolated remediation branch/worktree: `codecgr/txodds-release-hardening` at the
  same commit, `/tmp/txodds-release-hardening`.
- Both release worktrees were clean. The unrelated modified `package-lock.json`
  in `codecgr/txodds-director-main` was left untouched.
- Work is intentionally solo; no subagents were started.

## Read-only official recheck

Accessed 2026-07-18 06:42 BRT. No account, terms, contact, or submission action
was performed.

- Brasil listing: https://superteam.fun/earn/listing/world-cup-hackathon-brasil
  rendered Open, Brazil-only, five submissions and USDG 700/500/350/250/200.
- Global page: https://superteam.fun/earn/hackathon/world-cup rendered
  “Submissions open” and June 24–July 19.
- Consumer listing:
  https://superteam.fun/earn/listing/consumer-and-fan-experiences rendered Open,
  88 submissions and 10k/4k/2k USDT prizes.
- Terms: https://txline.txodds.com/documentation/legal/hackathon-terms still
  require human creation/control/submission and prohibit making TxODDS Data
  available. The earlier Brasil prose deadline therefore remains controlling,
  and persisting a normalized real replay remains blocked until the eligible
  human owner explicitly authorizes it under the applicable licence.

## Critical remediation scope

1. Bound the complete backend replay to 12 seconds, every Solana RPC attempt to
   three seconds, and the browser replay request to 12 seconds.
2. Preserve the score timeline when odds time out; mark proof timeout
   `unavailable`; expose the labeled fictional fallback after three seconds.
3. Replace fixture expiry with either an explicitly authorized, sanitized
   `recorded_txline` envelope or a dated rotating manifest plus real smoke gate.
4. Produce current field-by-field Global and Brasil packets with one shared
   repo/site/video URL set and an explicit Global-first double-submit sequence.
5. Replace stale handoff, audit and test records with post-fix commit, Node and
   Docker commands, evidence, hashes, video script and external checklist.
