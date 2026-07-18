import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildRealReplay } from "../server-dist/server/replay-service.js";
import { credentialsConfigured, readServerConfig } from "../server-dist/server/config.js";
import {
  ProofUnavailableError,
  validateStatV2View,
} from "../server-dist/server/proof.js";

const config = readServerConfig();
const manifest = JSON.parse(await readFile(new URL("../config/replay-manifest.json", import.meta.url), "utf8"));
const expected = manifest.expectedRealSmoke;
if (!credentialsConfigured(config)) {
  process.stderr.write("REAL SMOKE BLOCKED: set TXLINE_GUEST_JWT and TXLINE_API_TOKEN server-side.\n");
  process.exit(2);
}

try {
  let proofDiagnostic = null;
  const replay = await buildRealReplay(config, config.fixtureId, {
    verifyProof: async (...arguments_) => {
      try {
        return await validateStatV2View(...arguments_);
      } catch (error) {
        proofDiagnostic = error instanceof ProofUnavailableError
          ? { kind: error.name, message: error.message }
          : { kind: "unexpected_proof_failure" };
        throw error;
      }
    },
  });
  const turningEvent = replay.events.find(({ seq }) => seq === replay.turningPoint?.eventSeq);
  const safe = {
    sourceMode: replay.source.mode,
    fixtureId: replay.match.fixtureId,
    eventCount: replay.events.length,
    issueCodes: replay.issues.map((issue) => issue.code),
    turningPointPresent: replay.turningPoint !== null,
    turningPointSeq: replay.turningPoint?.eventSeq ?? null,
    turningPointMinute: replay.turningPoint?.minute ?? null,
    turningPointScore: turningEvent?.score ?? null,
    comparableBeforePct: replay.turningPoint?.movement.before.pct ?? null,
    comparableAfterPct: replay.turningPoint?.movement.after.pct ?? null,
    comparableDeltaPercentagePoints: replay.turningPoint?.movement.deltaPercentagePoints ?? null,
    provenanceState: replay.provenance.state,
    provenanceReason: replay.provenance.reason,
    proofDiagnostic,
    epochDay: replay.provenance.epochDay,
    endpointStatuses: replay.source.endpoints.map(({ id, status }) => ({ id, status })),
    normalizedEnvelopeSha256: createHash("sha256").update(JSON.stringify(replay)).digest("hex"),
  };
  process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  const endpointsGreen = safe.endpointStatuses.length === 5 && safe.endpointStatuses.every(({ status }) => status >= 200 && status < 300);
  if (
    safe.sourceMode !== "real_txline" ||
    safe.eventCount < 1 ||
    !safe.turningPointPresent ||
    safe.turningPointSeq !== expected.turningPointSeq ||
    safe.turningPointMinute !== expected.turningPointMinute ||
    safe.turningPointScore?.participant1 !== expected.participant1Score ||
    safe.turningPointScore?.participant2 !== expected.participant2Score ||
    Math.abs((safe.comparableBeforePct ?? 0) - expected.beforePct) > 0.001 ||
    Math.abs((safe.comparableAfterPct ?? 0) - expected.afterPct) > 0.001 ||
    safe.epochDay !== expected.proofEpochDay ||
    safe.provenanceState !== "verified" ||
    !endpointsGreen
  ) {
    process.stderr.write("REAL SMOKE NOT GREEN: real data returned, but the submission gate is not satisfied.\n");
    process.exit(1);
  }
  process.stdout.write(`REAL SMOKE GREEN: manifest fixture ${manifest.fixtureId} selected the ${expected.turningPointMinute}′ lead reversal and seq-${expected.turningPointSeq} validateStatV2 view.\n`);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNEXPECTED_ERROR";
  const upstreamStatus = error && typeof error === "object" && "upstreamStatus" in error ? error.upstreamStatus : null;
  process.stderr.write(`REAL SMOKE FAILED: ${code}${upstreamStatus ? ` (upstream ${upstreamStatus})` : ""}\n`);
  process.exit(1);
}
