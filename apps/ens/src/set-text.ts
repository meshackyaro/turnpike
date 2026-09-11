import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { createPublicClient, createWalletClient, fallback, http, namehash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ENSV2 } from "./contracts.js";

config({
  path: pathResolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

const NAME = process.argv[2];
const KEY = process.argv[3];
const VALUE = process.argv[4];

if (!NAME || !KEY || VALUE === undefined) {
  console.error(`usage: set-text <name> <key> <value>`);
  process.exit(1);
}

const resolverAbi = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

const rawKey =
  env("ENS_OWNER_PRIVATE_KEY") ??
  env("EVM_PRIVATE_KEY") ??
  env("HEDERA_BUYER_PRIVATE_KEY");
if (!rawKey) throw new Error("No key: set ENS_OWNER_PRIVATE_KEY in .env");

const account = privateKeyToAccount(
  (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
);

const transport = fallback(
  [
    env("SEPOLIA_RPC_URL"),
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org",
    "https://sepolia.drpc.org",
  ]
    .filter((u): u is string => Boolean(u))
    .map((url) => http(url, { retryCount: 3, timeout: 20_000 })),
);

const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

async function main() {
  const node = namehash(NAME);
  console.log(`name  ${NAME}`);
  console.log(`node  ${node}`);
  console.log(`key   ${KEY}\n`);

  const tx = await walletClient.writeContract({
    address: ENSV2.publicResolver,
    abi: resolverAbi,
    functionName: "setText",
    args: [node, KEY, VALUE],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`setText  ${tx}  (${receipt.status})`);

  // Read back two ways: straight off the resolver, and through the universal
  // resolver the way a client actually would.
  const direct = await publicClient.readContract({
    address: ENSV2.publicResolver,
    abi: resolverAbi,
    functionName: "text",
    args: [node, KEY],
  });
  console.log(`\ndirect from resolver     ${JSON.stringify(direct)}`);

  const viaUniversal = await publicClient.getEnsText({
    name: NAME,
    key: KEY,
    universalResolverAddress: ENSV2.universalResolver,
  });
  console.log(`via UniversalResolverV2  ${JSON.stringify(viaUniversal)}`);

  console.log(
    direct === VALUE && viaUniversal === VALUE
      ? `\nround-trip OK`
      : `\nMISMATCH — wrote ${JSON.stringify(VALUE)}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
