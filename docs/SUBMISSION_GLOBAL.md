# Global submission packet — Consumer and Fan Experiences

Form inspected read-only on 2026-07-18 06:57 BRT:
https://superteam.fun/earn/listing/consumer-and-fan-experiences

Submit this form **first**. Every required field below still has a human owner:
the eligible team leader named in `docs/HUMAN_OWNERSHIP.md`. Do not click Submit
until that file, the three URLs, and the final human review are complete.

## One shared URL set

Use these exact same three values in this packet and in
`docs/SUBMISSION_BRASIL.md`:

- `LIVE_URL`: **[REQUIRED — public HTTPS deployment]**
- `VIDEO_URL`: **[REQUIRED — public/unlisted Loom or YouTube, <= 5:00]**
- `REPO_URL`: **[REQUIRED — public repository]**

## Current form, field by field

### 1. Link to Your Submission *

Owner: human team leader. Value: `LIVE_URL`.

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

The deployed Node backend performs a five-call authenticated TxLINE chain, normalizes it into one browser-safe ReplayEnvelope, and never returns raw proof blobs or credentials. There is no synthetic match route: unavailable real data fails closed with a retryable error, and the browser rejects any non-`real_txline` envelope. The complete backend attempt is capped at 12 seconds and every Solana RPC request at three seconds. A dated replay manifest prevents the selected historical fixture from silently expiring.

Product path: clubs, broadcasters, and streaming apps can embed the catch-up layer at live-match entry, sponsor the shareable Turning Point card, and offer premium multi-match alerts while keeping the core fan experience free and non-wagering.
```

### 5. Link to your live & working MVP *

Value: `LIVE_URL`.

### 6. Link to Your Live Demo Video *

Value: `VIDEO_URL`. Verify incognito playback and duration <= 5:00.

### 7. Project's Public Repository Link *

Value: `REPO_URL`.

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

Friction: the authenticated historical endpoint returned a finite text/event-stream even though the reference/example described a JSON array; sparse Score fields required the complete Stats[1]/Stats[2] totals; nullable odds tuple fields need clearer semantics; a read-only Anchor simulation still needs a funded public devnet payer; historical eligibility is only six hours to two weeks; and the public testability requirement is hard to reconcile with the terms' Data-display restriction. We addressed reliability with bounded bodies, same-tuple comparisons, a dated rotation manifest, a 12-second total deadline, a three-second abortable RPC, honest unavailable states, and a real-data-only, fail-closed route. No raw response, credential, or proof blob is committed.
```

### 11. Anything Else?

Before the Global submit, use:

```text
Track: Consumer and Fan Experiences. This is the first step of the mandatory Global + Brasil double submission; the identical Torcida Pulse project, LIVE_URL, VIDEO_URL, and REPO_URL will be submitted to the Superteam Brasil listing immediately after this confirmation is captured. New hackathon project; human owner: [REQUIRED NAME/HANDLE]; build window: 2026-07-17 20:25 BRT to the final human review at [REQUIRED TIME]. The app has no synthetic match fallback; normalized real-data access remains server-side and subject to TxODDS-authorized access instructions.
```

Replace the three URL labels and both owner placeholders with their final values.

### 12. Scope confirmation checkbox *

Human-only action. Check only after personally reviewing the Consumer scope,
working deployment, video, public repository, and all statements above.

## Submit and capture confirmation

1. Submit Consumer first, before 2026-07-18 23:59 BRT.
2. Record BRT and UTC time, confirmation ID/URL, and a full-page screenshot in
   the ignored `research-harness/records/submissions/private/` directory.
3. Compute the screenshot SHA-256 and update
   `research-harness/records/submissions/CONFIRMATIONS.md`.
4. Put the Consumer confirmation time/ID into the Brasil packet, then submit the
   Brasil listing. Do not reverse this order.
