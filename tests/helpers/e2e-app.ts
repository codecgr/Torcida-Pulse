import { createTorcidaServer } from "../../server/app";
import { readServerConfig } from "../../server/config";

const config = readServerConfig();
const server = createTorcidaServer(config, {
  verifyProof: async () => ({
    valid: true,
    epochDay: 20649,
    dailyScoresPda: "HJ6nSVkUs4VG9JQ5sEUq3VbmyUSBf76ePXUCATLtRYTX",
    proofTargetTs: 1784143500000,
  }),
  now: () => new Date("2026-07-17T12:00:00.000Z"),
  mintCollectible: async (metadataUri) => ({
    network: "devnet",
    standard: "Metaplex Core",
    assetAddress: "7dHbWXadE16cqsQz8xF8FvVjpmg9kPrJgC7QwK3jT91P",
    ownerAddress: "AMoP5pTLuFRioTrLUgwWt3sBYF4RAJNLVXy8D6BQtdW8",
    signature: "4".repeat(88),
    metadataUri,
    explorerAssetUrl: "https://explorer.solana.com/address/7dHbWXadE16cqsQz8xF8FvVjpmg9kPrJgC7QwK3jT91P?cluster=devnet",
    explorerTransactionUrl: `https://explorer.solana.com/tx/${"4".repeat(88)}?cluster=devnet`,
  }),
});
server.listen(config.port, "127.0.0.1", () => process.stdout.write(`E2E app on ${config.port}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
