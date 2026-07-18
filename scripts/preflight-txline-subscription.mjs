/**
 * Read-only TxLINE free-tier subscription preflight.
 *
 * This script intentionally accepts only a public address. It cannot load a
 * keypair, sign a transaction, submit a transaction, or activate API access.
 * The RPC simulation is non-persistent and signature verification is disabled.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const RPC_URL = "https://api.devnet.solana.com";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;

if (process.argv.length > 2) {
  throw new Error("This read-only preflight accepts no command-line arguments.");
}

const payerValue = process.env.SOLANA_SIMULATION_PAYER;
if (!payerValue) {
  throw new Error("Set SOLANA_SIMULATION_PAYER to the disposable Devnet public address.");
}
const payer = new PublicKey(payerValue);

const connection = new Connection(RPC_URL, "confirmed");
for (const method of ["sendTransaction", "sendRawTransaction"]) {
  Object.defineProperty(connection, method, {
    value: () => {
      throw new Error(`${method} is disabled in read-only preflight`);
    },
  });
}

const readOnlyWallet = {
  publicKey: payer,
  signTransaction() {
    throw new Error("Signing is disabled in read-only preflight");
  },
  signAllTransactions() {
    throw new Error("Signing is disabled in read-only preflight");
  },
};

const idl = JSON.parse(readFileSync(new URL("../vendor/txodds/devnet-txoracle.json", import.meta.url), "utf8"));
const provider = new anchor.AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function associatedTokenAddress(owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), TOKEN_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAssociatedTokenInstruction(address) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: address, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: false, isWritable: false },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

const genesis = await connection.getGenesisHash();
assert(genesis === DEVNET_GENESIS, `Refusing non-Devnet cluster with genesis ${genesis}`);
assert(program.programId.equals(PROGRAM_ID), "Pinned IDL program address mismatch");

const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], PROGRAM_ID);
const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], PROGRAM_ID);
const userTokenAccount = associatedTokenAddress(payer);
const tokenTreasuryVault = associatedTokenAddress(tokenTreasuryPda);

const [programInfo, mintInfo, pricingInfo, treasuryInfo, userTokenInfo] = await connection.getMultipleAccountsInfo(
  [PROGRAM_ID, TOKEN_MINT, pricingMatrix, tokenTreasuryVault, userTokenAccount],
  "confirmed",
);
assert(programInfo?.executable === true, "TxLINE program is not executable");
assert(mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID), "TxL mint is not owned by Token-2022");
assert(pricingInfo?.owner.equals(PROGRAM_ID), "Pricing matrix is not owned by TxLINE program");
assert(treasuryInfo?.owner.equals(TOKEN_2022_PROGRAM_ID), "Treasury vault is not owned by Token-2022");
if (userTokenInfo) {
  assert(userTokenInfo.owner.equals(TOKEN_2022_PROGRAM_ID), "Existing user token account has the wrong owner");
}

const matrix = await program.account.pricingMatrix.fetch(pricingMatrix);
const row = matrix.rows.find((candidate) => Number(candidate.rowId) === SERVICE_LEVEL_ID);
assert(row, `Service level ${SERVICE_LEVEL_ID} is absent from the pricing matrix`);
assert(row.pricePerWeekToken.toString() === "0", "Selected service level is not free");
assert(DURATION_WEEKS >= 4 && DURATION_WEEKS % 4 === 0, "Duration must be a multiple of four weeks");

const transaction = new Transaction();
if (!userTokenInfo) transaction.add(createAssociatedTokenInstruction(userTokenAccount));

const subscription = await program.methods
  .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
  .accounts({
    user: payer,
    pricingMatrix,
    tokenMint: TOKEN_MINT,
    userTokenAccount,
    tokenTreasuryVault,
    tokenTreasuryPda,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .transaction();
transaction.add(...subscription.instructions);
transaction.feePayer = payer;
transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

const expectedPrograms = userTokenInfo
  ? [PROGRAM_ID.toBase58()]
  : [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), PROGRAM_ID.toBase58()];
const instructionPrograms = transaction.instructions.map((instruction) => instruction.programId.toBase58());
assert(JSON.stringify(instructionPrograms) === JSON.stringify(expectedPrograms), "Unexpected instruction program");
for (const instruction of transaction.instructions) {
  for (const account of instruction.keys) {
    assert(!account.isSigner || account.pubkey.equals(payer), "Unexpected required signer");
  }
}

const subscribeInstruction = transaction.instructions.at(-1);
const decoded = program.coder.instruction.decode(subscribeInstruction.data);
assert(decoded?.name === "subscribe", "Final instruction is not TxLINE subscribe");
assert(decoded.data.serviceLevelId === SERVICE_LEVEL_ID, "Service level changed during encoding");
assert(decoded.data.weeks === DURATION_WEEKS, "Duration changed during encoding");
assert(transaction.signature === null, "Transaction unexpectedly has a signature");

const message = transaction.compileMessage();
const messageFingerprint = createHash("sha256").update(message.serialize()).digest("hex");
const estimatedFee = await connection.getFeeForMessage(message, "confirmed");
assert(estimatedFee.value !== null, "RPC could not estimate transaction fee");

const [balanceBefore, signaturesBefore] = await Promise.all([
  connection.getBalance(payer, "confirmed"),
  connection.getSignaturesForAddress(payer, { limit: 5 }, "confirmed"),
]);

// No signer array is supplied. web3.js therefore serializes zero signatures and
// asks the RPC to simulate without signature verification or state persistence.
const simulation = await connection.simulateTransaction(transaction, undefined, [payer, userTokenAccount]);
assert(simulation.value.err === null, `Simulation failed: ${JSON.stringify(simulation.value.err)}`);
assert(simulation.value.logs?.some((line) => line.includes("Instruction: Subscribe")), "Subscribe did not execute");
assert(
  simulation.value.logs?.some((line) => line.includes("Subscription processed: 0 Units for 4 weeks")),
  "Simulation did not confirm a zero-token four-week subscription",
);

const simulatedPayer = simulation.value.accounts?.[0];
const simulatedTokenAccount = simulation.value.accounts?.[1];
assert(simulatedPayer, "Simulation did not return the payer account");
assert(simulatedTokenAccount, "Simulation did not return the user token account");
assert(simulatedTokenAccount.owner === TOKEN_2022_PROGRAM_ID.toBase58(), "Simulated token account owner mismatch");

const [balanceAfter, signaturesAfter] = await Promise.all([
  connection.getBalance(payer, "confirmed"),
  connection.getSignaturesForAddress(payer, { limit: 5 }, "confirmed"),
]);
assert(balanceAfter === balanceBefore, "Read-only preflight unexpectedly changed wallet balance");
assert(
  JSON.stringify(signaturesAfter.map(({ signature }) => signature)) ===
    JSON.stringify(signaturesBefore.map(({ signature }) => signature)),
  "Read-only preflight unexpectedly changed wallet history",
);
assert(transaction.signature === null, "Transaction was signed during simulation");

const projectedDebitLamports = balanceBefore - simulatedPayer.lamports;
const result = {
  status: "ready_for_signature_authorization",
  mutation: "none",
  network: {
    cluster: "devnet",
    genesis,
    rpc: RPC_URL,
  },
  wallet: {
    publicKey: payer.toBase58(),
    balanceLamports: balanceBefore,
    balanceSol: balanceBefore / 1_000_000_000,
    signaturesBefore: signaturesBefore.length,
    signaturesAfter: signaturesAfter.length,
  },
  subscription: {
    programId: PROGRAM_ID.toBase58(),
    serviceLevelId: SERVICE_LEVEL_ID,
    durationWeeks: DURATION_WEEKS,
    tokenUnits: "0",
    samplingIntervalSec: Number(row.samplingIntervalSec),
    leagueBundleId: Number(row.leagueBundleId),
    marketBundleId: Number(row.marketBundleId),
  },
  transaction: {
    signed: false,
    broadcast: false,
    createsUserTokenAccount: !userTokenInfo,
    userTokenAccount: userTokenAccount.toBase58(),
    instructionPrograms,
    requiredSigners: [payer.toBase58()],
    estimatedFeeLamports: estimatedFee.value,
    projectedDebitLamports,
    projectedDebitSol: projectedDebitLamports / 1_000_000_000,
    messageFingerprint,
  },
  simulation: {
    ok: true,
    unitsConsumed: simulation.value.unitsConsumed,
    tokenPaymentConfirmedZero: true,
    statePersisted: false,
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
