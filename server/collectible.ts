import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import { base58, generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

export interface CollectibleMintConfig {
  rpcUrl: string;
  authoritySecret: string | null;
  authorityPath: string | null;
}

export interface MintedCollectible {
  network: "devnet";
  standard: "Metaplex Core";
  assetAddress: string;
  ownerAddress: string;
  signature: string;
  metadataUri: string;
  explorerAssetUrl: string;
  explorerTransactionUrl: string;
}

function parseSecret(value: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("SOLANA_COLLECTIBLE_AUTHORITY must be a JSON secret-key byte array.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("SOLANA_COLLECTIBLE_AUTHORITY must contain exactly 64 secret-key bytes.");
  }
  return Uint8Array.from(parsed as number[]);
}

function authoritySecret(config: CollectibleMintConfig): Uint8Array {
  if (config.authoritySecret) return parseSecret(config.authoritySecret);
  if (config.authorityPath) {
    return parseSecret(readFileSync(resolve(config.authorityPath), "utf8"));
  }
  throw new Error("The Solana collectible authority is not configured.");
}

export async function mintLegendaryCollectible(
  config: CollectibleMintConfig,
  metadataUri: string,
): Promise<MintedCollectible> {
  const umi = createUmi(config.rpcUrl).use(mplCore());
  const authority = umi.eddsa.createKeypairFromSecretKey(authoritySecret(config));
  umi.use(keypairIdentity(authority));
  const asset = generateSigner(umi);
  const result = await create(umi, {
    asset,
    name: "Torcida Pulse — A Virada Depois da Virada",
    uri: metadataUri,
  }).sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });
  const signature = base58.deserialize(result.signature)[0];
  const assetAddress = asset.publicKey.toString();
  const ownerAddress = authority.publicKey.toString();
  return {
    network: "devnet",
    standard: "Metaplex Core",
    assetAddress,
    ownerAddress,
    signature,
    metadataUri,
    explorerAssetUrl: `https://explorer.solana.com/address/${assetAddress}?cluster=devnet`,
    explorerTransactionUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  };
}
