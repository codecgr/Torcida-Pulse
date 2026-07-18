import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../config/replay-manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const now = process.env.REPLAY_MANIFEST_NOW
  ? Date.parse(process.env.REPLAY_MANIFEST_NOW)
  : Date.now();

function timestamp(name) {
  const parsed = Date.parse(manifest[name]);
  if (!Number.isFinite(parsed)) throw new Error(`Replay manifest ${name} is not a valid ISO timestamp.`);
  return parsed;
}

if (manifest.schemaVersion !== 1 || !/^\d+$/.test(String(manifest.fixtureId)) || !Number.isInteger(manifest.startEpochDay)) {
  throw new Error("Replay manifest identity is invalid.");
}
if (!Number.isFinite(now)) throw new Error("REPLAY_MANIFEST_NOW must be an ISO timestamp when set.");

const eligibleAfter = timestamp("historicalEligibleAfter");
const eligibleUntil = timestamp("historicalEligibleUntil");
const rotateBefore = timestamp("rotateBefore");
if (!(eligibleAfter < rotateBefore && rotateBefore < eligibleUntil)) {
  throw new Error("Replay manifest eligibility dates are not ordered.");
}

const summary = {
  fixtureId: manifest.fixtureId,
  startEpochDay: manifest.startEpochDay,
  checkedAt: new Date(now).toISOString(),
  rotateBefore: manifest.rotateBefore,
  historicalEligibleUntil: manifest.historicalEligibleUntil,
};
if (now < eligibleAfter) {
  process.stderr.write(`${JSON.stringify({ status: "REPLAY_MANIFEST_TOO_EARLY", ...summary })}\n`);
  process.exit(1);
}
if (now >= eligibleUntil) {
  process.stderr.write(`${JSON.stringify({ status: "REPLAY_MANIFEST_EXPIRED", ...summary })}\n`);
  process.exit(1);
}
if (now >= rotateBefore) {
  process.stderr.write(`${JSON.stringify({ status: "REPLAY_MANIFEST_ROTATION_DUE", ...summary })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ status: "REPLAY_MANIFEST_GREEN", ...summary })}\n`);
