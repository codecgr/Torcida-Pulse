import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { credentialsConfigured, readServerConfig, TXLINE_DEVNET_ORIGIN, TXLINE_PROGRAM_ID } from "../server/config";

describe("server-only configuration", () => {
  it("requires both credentials and freezes official devnet constants", () => {
    const empty = readServerConfig({ NODE_ENV: "test" });
    expect(credentialsConfigured(empty)).toBe(false);
    const full = readServerConfig({
      NODE_ENV: "test",
      TXLINE_GUEST_JWT: "jwt-test",
      TXLINE_API_TOKEN: "api-test",
    });
    expect(credentialsConfigured(full)).toBe(true);
    expect(full.apiOrigin).toBe(TXLINE_DEVNET_ORIGIN);
    expect(full.fixtureId).toBe("18241006");
    expect(full.startEpochDay).toBe(20649);
    expect(full.replayCacheTtlMs).toBe(300_000);
    expect(full.replayRateLimitMax).toBe(30);
    expect(TXLINE_PROGRAM_ID).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
  });

  it("parses judge access and a deterministic real-data shutdown window", () => {
    const configured = readServerConfig({
      NODE_ENV: "production",
      JUDGE_ACCESS_TOKEN: "judge-access-test-only",
      REAL_DATA_DISABLE_AT: "2026-07-20T03:00:00.000Z",
    });
    expect(configured.judgeAccessToken).toBe("judge-access-test-only");
    expect(configured.realDataDisableAt).toBe(1784516400000);
    expect(() => readServerConfig({ NODE_ENV: "production", JUDGE_ACCESS_TOKEN: "short" })).toThrow(/16/);
    expect(() => readServerConfig({ NODE_ENV: "production", REAL_DATA_DISABLE_AT: "not-a-date" })).toThrow(/ISO-8601/);
  });

  it("rejects custom production hosts and RPCs", () => {
    expect(() => readServerConfig({ NODE_ENV: "production", TXLINE_API_ORIGIN: "https://evil.invalid" })).toThrow();
    expect(() => readServerConfig({ NODE_ENV: "production", SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" })).toThrow();
  });

  it("contains no process.env or credential header construction in browser source", () => {
    const root = resolve(process.cwd(), "src");
    const source = ["main.ts", "types.ts", "timeline.ts", "momentum.ts", "i18n.ts"]
      .map((file) => readFileSync(resolve(root, file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/process\.env|TXLINE_GUEST_JWT|TXLINE_API_TOKEN|X-Api-Token|Authorization\s*:/);
  });
});
