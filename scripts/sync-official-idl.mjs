import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commit = "3a1d6f0cfc34ce173f0778023d2332161359196d";
const expected = "1e7d55726eda9ad4d6ef62910fe5d7e007c687f4ff8b1c771a42b69b7089724e";
const url = `https://raw.githubusercontent.com/txodds/tx-on-chain/${commit}/examples/devnet/idl/txoracle.json`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "vendor/txodds/devnet-txoracle.json");

const response = await fetch(url);
if (!response.ok) throw new Error(`Official IDL fetch failed with HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expected) throw new Error(`Official IDL hash mismatch: ${actual}`);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
process.stdout.write(`Pinned official devnet IDL synced (${actual}).\n`);
