import { describe, expect, it } from "vitest";
import {
  fetchWithRpcDeadline,
  SOLANA_RPC_TIMEOUT_MS,
} from "../server/proof";

describe("Solana RPC deadline", () => {
  it("is fixed at three seconds and aborts the underlying fetch", async () => {
    expect(SOLANA_RPC_TIMEOUT_MS).toBe(3_000);
    const requestSignals: AbortSignal[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestSignal = init?.signal;
      if (requestSignal) requestSignals.push(requestSignal);
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          reject(requestSignal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    }) as typeof fetch;
    const started = Date.now();

    await expect(fetchWithRpcDeadline("https://rpc.invalid", undefined, undefined, fetchImpl, 15))
      .rejects.toBeDefined();

    expect(Date.now() - started).toBeLessThan(250);
    expect(requestSignals[0]?.aborted).toBe(true);
  });
});
