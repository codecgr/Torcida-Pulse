# Global submission packet — Consumer and Fan Experiences

> **Submission strategy (updated 2026-07-19):** no public HTTPS deployment will
> be submitted. The entry is delivered as a **working demo video** plus the
> **public GitHub repository**. `LIVE_URL` is therefore filled with the public
> repository (the repo is the inspectable artifact), and `VIDEO_URL` carries the
> spoiler-safe catch-up running locally. This keeps the submission honest given
> the two-day build window and the TxODDS data-display restriction (real data is
> shown only behind the private judge code, never in public screenshots/video
> without written TxODDS permission).

Form inspected read-only on 2026-07-18 06:57 BRT:
https://superteam.fun/earn/listing/consumer-and-fan-experiences

Submit this form **first**. Every required field below still has a human owner:
the eligible team leader named in `docs/HUMAN_OWNERSHIP.md`. Do not click Submit
until that file, the three URLs, and the final human review are complete.

## One shared URL set

Use these exact same three values in this packet and in
`docs/SUBMISSION_BRASIL.md`:

- `LIVE_URL`: **https://github.com/codecgr/Torcida-Pulse**
- `VIDEO_URL`: **[REQUIRED — public/unlisted Loom or YouTube, <= 5:00]**
- `REPO_URL`: **https://github.com/codecgr/Torcida-Pulse**

> If the repository is not yet public at submit time, leave `LIVE_URL` and
> `REPO_URL` as `[A DEFINIR]` and note it in `docs/HUMAN_OWNERSHIP.md`. Do not
> invent a deployment URL.

## Current form, field by field

### 1. Link to Your Submission *

Owner: human team leader. Value: `LIVE_URL` (public repository).

### 2. Tweet Link

Optional. Leave blank unless the human owner has already published an accurate
project post. Do not delay submission to create one.

### 3. Project Title *

```text
Torcida Pulse
```

### 4. Briefly explain your Project *

```text
Torcida Pulse is a new project created specifically for the 2026 TxODDS World Cup Hackathon. The internal project/harness history starts on 17 July 2026 at 20:25 BRT and the public release lineage starts on 18 July at 02:58 BRT; the eligible human owner and exact material-review time are recorded in docs/HUMAN_OWNERSHIP.md before submission.

It is a mobile-first, Portuguese/English, non-wagering live catch-up layer for the fan who joins a match late. Instead of showing a score or a generic highlights reel, one tap compresses everything already played into a 20-second, spoiler-safe journey from kick-off to now. Every revealed TxLINE event updates the score, event feed, and match Pulse at the correct instant; the experience pauses at the factual lead reversal, clears the player from the viewport, and explains the shift in plain fan language. The current real-data fixture demonstrates this complete catch-up journey with a finished match and explicitly labels that state—it does not pretend the historical fixture is live. There is no betting, custody, trading, wallet requirement, or financial recommendation.

The Node backend performs a five-call authenticated TxLINE chain, normalizes it into one browser-safe ReplayEnvelope, and never returns raw proof blobs or credentials. There is no synthetic match route: unavailable real data fails closed with a retryable error, and the browser rejects any non-`real_txline` envelope. The complete backend attempt is capped at 12 seconds and every Solana RPC request at three seconds. A dated replay manifest prevents the selected historical fixture from silently expiring.

Note on this submission: there is no hosted HTTPS deployment. The public artifact is the GitHub repository plus a screen-captured demo video showing the full spoiler-safe catch-up running locally, including the factual Turning Point auto-pause. The real-data path is gated behind a private judge code in the code and is not represented as a live public URL.

On-chain collectible (honest scope): the most dramatic turning point is offered as a Legendary drop and minted on Solana devnet. The artwork shown today (England 1-2 Argentina, 91' reversal) is a single pre-generated example image we made by hand from that match's data as a concept piece; the mint metadata labels it "Pre-generated generative AI example". It is not generated per match. What works today is turning-point detection, the drop-card UI, and the devnet mint pointing at that example. The product vision is to generate each artwork uniquely from a match's own data and mint that unique piece; that generation pipeline is not built yet and is not claimed as working.

Product path: clubs, broadcasters, and streaming apps can embed the catch-up layer at live-match entry, sponsor the shareable Turning Point card, and offer premium multi-match alerts while keeping the core fan experience free and non-wagering.
```

### 5. Link to your live & working MVP *

Value: `LIVE_URL` (public repository). The repo contains the runnable source,
build, and `npm run verify` evidence so reviewers can run the experience locally.

### 6. Link to Your Live Demo Video *

Value: `VIDEO_URL`. Verify incognito playback and duration <= 5:00. The video
must show the spoiler-safe catch-up and the factual Turning Point auto-pause,
and must **not** claim Solana proof as verified unless a green strict smoke was
recorded first.

### 7. Project's Public Repository Link *

Value: `REPO_URL`. The repository landing page must render the README, setup,
deployment, five TxLINE calls, API feedback, licences, and test commands.

### 8. Link to your Project's Technical Documentation

Value: `REPO_URL`. The repository landing page must render the README, setup,
deployment, five TxLINE calls, API feedback, licences, and test commands.

### 9. Link to your Project's X Profile or a tweet about it

Optional. Leave blank unless already public and accurate.

### 10. Share your team's experience using the TxLINE API *

```text
What worked: the two-header authentication boundary was straightforward to keep server-side; the normalized fixture/score/odds shapes made the replay pipeline compact; participant totals plus statKeys=1,2 produced an exact score predicate; and the official devnet IDL supported a read-only validateStatV2 view without an end-user wallet.

The five real calls used by the backend are:
1) GET /api/fixtures/snapshot?startEpochDay=20649
2) GET /api/scores/historical/18241006
3) GET /api/odds/snapshot/18241006?asOf=<turning-point timestamp minus 120000 ms>
4) GET /api/odds/snapshot/18241006?asOf=<turning-point timestamp plus 120000 ms>
5) GET /api/scores/stat-validation?fixtureId=18241006&seq=871&statKeys=1,2

Friction: the authenticated historical endpoint returned a finite text/event-stream even though the reference/example described a JSON array; sparse Score fields required the complete Stats[1]/Stats[2] totals; nullable odds tuple fields need clearer semantics; a read-only Anchor simulation still needs a funded public devnet payer; historical eligibility is only six hours to two weeks; and the public testability requirement is hard to reconcile with the terms' Data-display restriction. We addressed reliability with bounded bodies, same-tuple comparisons, a dated rotation manifest, a 12-second total deadline, a three-second abortable RPC, honest unavailable states, and a fail-closed browser that rejects non-`real_txline` envelopes.

On this submission: there is no hosted HTTPS deployment. We deliver the full working experience through the public repository and a locally captured demo video, with the real-data route kept behind a private judge code rather than exposed as a public URL.
```

### 11. Anything Else?

```text
No hosted live URL is provided; the inspectable artifact is the public GitHub repository plus a screen-captured demo video of the spoiler-safe 20-second catch-up and factual Turning Point auto-pause. The real TxLINE path is gated behind a private judge code in the code and is not represented as a public deployment. Built during the hackathon window (started 17 July 2026, released 18 July); human-owned and submitted by the eligible participant named in docs/HUMAN_OWNERSHIP.md. The product is for fans and offers no betting, custody, wallet, or financial advice.
```

### 12. How can judges run or verify this project?

The repository is the inspectable artifact. Clone it, run `npm ci`, `npm run
build`, and `npm start`, then open the served URL on a 375 px viewport and tap
`Watch spoiler-free` to see the spoiler-safe 20-second catch-up and the factual
Turning Point auto-pause. `npm run verify` reproduces the 69 unit/integration
and 51 E2E tests. The demo video (`VIDEO_URL`) shows the same flow captured
locally. There is no hosted HTTPS site; the real-data route requires a private
judge code and is not exposed as a public URL.

## Pre-submit checklist (human)

- [ ] `docs/HUMAN_OWNERSHIP.md` complete, including final human commit hash.
- [ ] Public repository exists and `LIVE_URL`/`REPO_URL` match it exactly.
- [ ] `VIDEO_URL` is public/unlisted, <= 5:00, and shows the factual auto-pause.
- [ ] Video does **not** claim Solana proof verified unless a green strict smoke
      was recorded; otherwise it states provenance `unavailable`.
- [ ] Final material review done by the human owner, committed with real Git identity.

No account, terms acceptance, public push, deployment, video publication,
organizer contact, credit spend, KYC, or submission was performed by the agent.
