import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  fallback,
  http,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { ENSV2, SEPOLIA_USDC, registrarAbi } from "./contracts.js";

config({
  path: pathResolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

const LABEL = process.argv[2] ?? "turnpike";
const DURATION = 31_536_000n; // 1 year; registrar enforces a 28-day minimum
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const NO_REFERRER =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const rawKey =
  env("ENS_OWNER_PRIVATE_KEY") ??
  env("EVM_PRIVATE_KEY") ??
  env("HEDERA_BUYER_PRIVATE_KEY");
if (!rawKey) throw new Error("No key: set ENS_OWNER_PRIVATE_KEY in .env");

const account = privateKeyToAccount(
  (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
);

// A single public RPC dropped the approve mid-flow and cost a commitment.
// fallback() rotates on transport errors.
const rpcUrls = [
  env("SEPOLIA_RPC_URL"),
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
  "https://sepolia.drpc.org",
].filter((u): u is string => Boolean(u));

const transport = fallback(
  rpcUrls.map((url) => http(url, { retryCount: 3, timeout: 20_000 })),
);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`label    ${LABEL}.eth`);
  console.log(`owner    ${account.address}`);
  console.log(`registry ENSv2 Sepolia\n`);

  const available = await publicClient.readContract({
    address: ENSV2.ethRegistrar,
    abi: registrarAbi,
    functionName: "isAvailable",
    args: [LABEL],
  });

  if (!available) {
    console.error(`${LABEL}.eth is not available`);
    process.exitCode = 1;
    return;
  }

  const [base, premium] = await publicClient.readContract({
    address: ENSV2.ethRegistrar,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [LABEL, DURATION, SEPOLIA_USDC],
  });
  const price = base + premium;
  console.log(`price    ${formatUnits(price, 6)} USDC for 1 year`);

  const held = await publicClient.readContract({
    address: SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`balance  ${formatUnits(held, 6)} USDC`);
  if (held < price) {
    console.error(`\nInsufficient USDC.`);
    process.exitCode = 1;
    return;
  }

  // The secret must survive from commit to register, and a transport failure
  // between the two otherwise strands the commitment — which is exactly what
  // happened on the first attempt. Persist it so a re-run resumes.
  const statePath = pathResolve(
    dirname(fileURLToPath(import.meta.url)),
    `../.commitment-${LABEL}.json`,
  );

  type Saved = { label: string; secret: `0x${string}`; committedAt: number };
  let saved: Saved | undefined;
  if (existsSync(statePath)) {
    const candidate = JSON.parse(readFileSync(statePath, "utf8")) as Saved;
    const ageSeconds = Math.floor(Date.now() / 1000) - candidate.committedAt;
    if (candidate.label === LABEL && ageSeconds < 86_400) {
      saved = candidate;
      console.log(`\nresuming commitment from ${ageSeconds}s ago`);
    }
  }

  const secret = saved?.secret ?? (toHex(randomBytes(32)) as `0x${string}`);

  const commitment = await publicClient.readContract({
    address: ENSV2.ethRegistrar,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [
      LABEL,
      account.address,
      secret,
      ZERO, // subregistry — set later when minting subnames
      ENSV2.publicResolver,
      DURATION,
      NO_REFERRER,
    ],
  });

  const minAge = await publicClient.readContract({
    address: ENSV2.ethRegistrar,
    abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
  });

  if (!saved) {
    console.log(`\ncommitting…`);
    const commitTx = await walletClient.writeContract({
      address: ENSV2.ethRegistrar,
      abi: registrarAbi,
      functionName: "commit",
      args: [commitment],
    });
    await publicClient.waitForTransactionReceipt({ hash: commitTx });
    console.log(`  ${commitTx}`);

    writeFileSync(
      statePath,
      JSON.stringify({
        label: LABEL,
        secret,
        committedAt: Math.floor(Date.now() / 1000),
      }),
    );

    const waitMs = (Number(minAge) + 5) * 1000;
    console.log(`\nwaiting ${waitMs / 1000}s for the commitment to age…`);
    await sleep(waitMs);
  }

  console.log(`approving ${formatUnits(price, 6)} USDC…`);
  const approveTx = await walletClient.writeContract({
    address: SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [ENSV2.ethRegistrar, price],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log(`  ${approveTx}`);

  console.log(`registering…`);
  const registerTx = await walletClient.writeContract({
    address: ENSV2.ethRegistrar,
    abi: registrarAbi,
    functionName: "register",
    args: [
      LABEL,
      account.address,
      secret,
      ZERO,
      ENSV2.publicResolver,
      DURATION,
      SEPOLIA_USDC,
      NO_REFERRER,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: registerTx,
  });
  console.log(`  ${registerTx}  (${receipt.status})`);

  if (existsSync(statePath)) unlinkSync(statePath);

  console.log(`\n${LABEL}.eth registered to ${account.address}`);
  console.log(`https://sepolia.etherscan.io/tx/${registerTx}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
