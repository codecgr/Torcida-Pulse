import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("TxLINE subscription preflight safety", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/preflight-txline-subscription.mjs"), "utf8");

  it("pins the free Devnet contract and transaction shape", () => {
    expect(source).toContain("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    expect(source).toContain("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(source).toContain("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
    expect(source).toContain("const SERVICE_LEVEL_ID = 1");
    expect(source).toContain("const DURATION_WEEKS = 4");
    expect(source).toContain('.subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)');
    expect(source).toContain('row.pricePerWeekToken.toString() === "0"');
  });

  it("cannot load secrets, sign, send, or persist simulation state", () => {
    expect(source).not.toMatch(/\bKeypair\b|fromSecretKey|secretKey|ANCHOR_WALLET/);
    expect(source).not.toMatch(/TXLINE_GUEST_JWT|TXLINE_API_TOKEN/);
    expect(source).not.toMatch(/connection\.(?:sendRawTransaction|sendTransaction)\s*\(/);
    expect(source).not.toMatch(/\.rpc\s*\(/);
    expect(source).toContain("Signing is disabled in read-only preflight");
    expect(source).toContain("sendRawTransaction");
    expect(source).toContain("transaction.signature === null");
    expect(source).toContain("statePersisted: false");
  });
});
