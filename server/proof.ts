import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  type FetchFn,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { RawValidationPayload, ScoreLine } from "../src/types.js";
import { TXLINE_PROGRAM_ID } from "./config.js";

export class ProofUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofUnavailableError";
  }
}

export class ProofTimeoutError extends ProofUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "ProofTimeoutError";
  }
}

export const SOLANA_RPC_TIMEOUT_MS = 3_000;

export async function fetchWithRpcDeadline(
  input: RequestInfo | URL,
  init?: RequestInit,
  replaySignal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SOLANA_RPC_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [timeoutSignal, replaySignal, init?.signal]
    .filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted || replaySignal?.aborted) {
      throw new ProofTimeoutError("Solana devnet RPC validation timed out.");
    }
    throw error;
  }
}

export interface ProofViewResult {
  valid: boolean;
  epochDay: number;
  dailyScoresPda: string;
  proofTargetTs: number;
  proofRangeEndTs?: number;
}

export interface ProofExpectation {
  fixtureId: string;
  seq: number;
  eventTs: number;
  statKeys: readonly [1, 2];
  score: ScoreLine;
}

async function simulationPayer(connection: Connection): Promise<PublicKey> {
  const configured = process.env.SOLANA_SIMULATION_PAYER?.trim();
  const validate = async (candidate: PublicKey): Promise<boolean> => {
    const info = await connection.getAccountInfo(candidate, "confirmed");
    return Boolean(
      info &&
      !info.executable &&
      info.owner.equals(SystemProgram.programId) &&
      info.lamports >= 5_000
    );
  };
  if (configured) {
    let candidate: PublicKey;
    try {
      candidate = new PublicKey(configured);
    } catch {
      throw new ProofUnavailableError("SOLANA_SIMULATION_PAYER is not a valid public key.");
    }
    if (!(await validate(candidate))) {
      throw new ProofUnavailableError("SOLANA_SIMULATION_PAYER is not a funded devnet system account.");
    }
    return candidate;
  }
  try {
    const largestResponse = await connection.getLargestAccounts({ filter: "circulating", commitment: "confirmed" });
    const largest = largestResponse.value;
    for (let index = 0; index < largest.length; index += 20) {
      const keys = largest.slice(index, index + 20).map((entry) => entry.address);
      const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
      const found = keys.find((_, offset) => {
        const info = infos[offset];
        return Boolean(info && !info.executable && info.owner.equals(SystemProgram.programId) && info.lamports >= 5_000);
      });
      if (found) return found;
    }
  } catch {
    // The public RPC may disable getLargestAccounts; the explicit public key remains the deterministic path.
  }
  throw new ProofUnavailableError("Set SOLANA_SIMULATION_PAYER to a funded devnet public address; no private key is required.");
}

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProofUnavailableError("Proof payload is missing an object required by validateStatV2.");
  }
  return value as Record<string, any>;
}

function bytes32(value: unknown): number[] {
  let bytes: Uint8Array;
  if (Array.isArray(value)) bytes = Uint8Array.from(value);
  else if (value instanceof Uint8Array) bytes = value;
  else if (typeof value === "string") {
    bytes = value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value, "base64");
  } else {
    throw new ProofUnavailableError("Proof hash has an unsupported encoding.");
  }
  if (bytes.length !== 32) throw new ProofUnavailableError("Proof hash is not 32 bytes.");
  return Array.from(bytes);
}

function proofNodes(value: unknown): Array<{ hash: number[]; isRightSibling: boolean }> {
  if (!Array.isArray(value)) throw new ProofUnavailableError("Merkle proof nodes are missing.");
  return value.map((node) => {
    const item = record(node);
    return { hash: bytes32(item.hash), isRightSibling: Boolean(item.isRightSibling) };
  });
}

export function buildValidationArguments(raw: RawValidationPayload, expected: ProofExpectation) {
  const expectedScore = expected.score;
  if (expectedScore.participant1 === null || expectedScore.participant2 === null) {
    throw new ProofUnavailableError("Participant-nested goal totals are missing for the observed sequence.");
  }
  const summary = record(raw.summary);
  const updateStats = record(summary.updateStats);
  if (!Number.isInteger(expected.seq) || expected.seq < 1) {
    throw new ProofUnavailableError("Selected proof sequence is invalid.");
  }
  if (String(summary.fixtureId) !== expected.fixtureId) {
    throw new ProofUnavailableError("Proof fixture does not match the selected fixture.");
  }
  if (expected.statKeys.length !== 2 || expected.statKeys[0] !== 1 || expected.statKeys[1] !== 2) {
    throw new ProofUnavailableError("Proof request must preserve statKeys=1,2 order.");
  }
  const targetTs = Number(updateStats.minTimestamp);
  if (!Number.isFinite(targetTs) || targetTs <= 0) {
    throw new ProofUnavailableError("Proof minTimestamp is invalid.");
  }
  const maxTimestamp = Number(updateStats.maxTimestamp);
  if (
    !Number.isFinite(maxTimestamp) ||
    maxTimestamp < targetTs ||
    expected.eventTs < targetTs ||
    expected.eventTs > maxTimestamp
  ) {
    throw new ProofUnavailableError("Proof timestamp does not match the selected event timestamp.");
  }
  const epochDay = Math.floor(targetTs / 86_400_000);
  if (epochDay < 0 || epochDay > 65_535) {
    throw new ProofUnavailableError("Proof epoch day does not fit the on-chain u16 seed.");
  }
  if (!Array.isArray(raw.statsToProve) || raw.statsToProve.length !== 2) {
    throw new ProofUnavailableError("Proof does not contain exactly the requested statKeys=1,2.");
  }
  if (!Array.isArray(raw.statProofs) || raw.statProofs.length !== 2) {
    throw new ProofUnavailableError("Proof statProofs do not match statKeys=1,2.");
  }
  const expectedValues = [expectedScore.participant1, expectedScore.participant2];
  raw.statsToProve.forEach((stat, index) => {
    const value = Number(record(stat).value);
    if (!Number.isFinite(value) || value !== expectedValues[index]) {
      throw new ProofUnavailableError("Proof stat order or score values do not match statKeys=1,2.");
    }
  });
  const payload = {
    ts: new BN(targetTs),
    fixtureSummary: {
      fixtureId: new BN(summary.fixtureId),
      updateStats: {
        updateCount: Number(updateStats.updateCount),
        minTimestamp: new BN(updateStats.minTimestamp),
        maxTimestamp: new BN(maxTimestamp),
      },
      eventsSubTreeRoot: bytes32(summary.eventStatsSubTreeRoot),
    },
    fixtureProof: proofNodes(raw.subTreeProof),
    mainTreeProof: proofNodes(raw.mainTreeProof),
    eventStatRoot: bytes32(raw.eventStatRoot),
    stats: raw.statsToProve.map((stat, index) => ({
      stat,
      statProof: proofNodes((raw.statProofs as unknown[])[index]),
    })),
  };
  const strategy = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: [
      { single: { index: 0, predicate: { threshold: expectedScore.participant1, comparison: { equalTo: {} } } } },
      { single: { index: 1, predicate: { threshold: expectedScore.participant2, comparison: { equalTo: {} } } } },
    ],
  };
  return { epochDay, proofTargetTs: targetTs, payload, strategy };
}

export async function validateStatV2View(
  raw: RawValidationPayload,
  expected: ProofExpectation,
  rpcUrl: string,
  replaySignal?: AbortSignal,
): Promise<ProofViewResult> {
  const { epochDay, proofTargetTs, payload, strategy } = buildValidationArguments(raw, expected);
  const idlPath = resolve(process.cwd(), "vendor/txodds/devnet-txoracle.json");
  let idl: anchor.Idl;
  try {
    idl = JSON.parse(await readFile(idlPath, "utf8")) as anchor.Idl;
  } catch {
    throw new ProofUnavailableError("Pinned official devnet IDL is unavailable.");
  }

  const rpcFetch = ((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) =>
    fetchWithRpcDeadline(
      input as RequestInfo | URL,
      init as RequestInit | undefined,
      replaySignal,
    )) as FetchFn;
  try {
    const connection = new Connection(rpcUrl, { commitment: "confirmed", fetch: rpcFetch });
    const payer = await simulationPayer(connection);
    const wallet = {
      publicKey: payer,
      signTransaction: async <T extends Transaction | VersionedTransaction>(_transaction: T): Promise<T> => {
        throw new ProofUnavailableError("Read-only validation never signs transactions.");
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(_transactions: T[]): Promise<T[]> => {
        throw new ProofUnavailableError("Read-only validation never signs transactions.");
      },
    } as anchor.Wallet;
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new anchor.Program(idl, provider);
    if (program.programId.toBase58() !== TXLINE_PROGRAM_ID) {
      throw new ProofUnavailableError("Pinned IDL program address does not match the frozen devnet program.");
    }

    const [dailyScoresPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
      program.programId
    );
    const result = await program.methods
      .validateStatV2(payload, strategy)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .view();
    return {
      valid: result === true,
      epochDay,
      dailyScoresPda: dailyScoresPda.toBase58(),
      proofTargetTs,
      proofRangeEndTs: Number(payload.fixtureSummary.updateStats.maxTimestamp.toString()),
    };
  } catch (error) {
    if (error instanceof ProofTimeoutError) throw error;
    if (replaySignal?.aborted) {
      throw new ProofTimeoutError("The complete replay deadline expired during proof validation.");
    }
    throw error;
  }
}
