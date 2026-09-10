import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

/** `??` does not fall through on an empty string, and blank env vars are the
 * normal state of a half-filled .env — so treat empty as absent. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

// Same address on every EVM testnet.
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const USDC = (env("ARC_USDC_ADDRESS") ??
  "0x3600000000000000000000000000000000000000") as `0x${string}`;

// Arc denominates native gas in 18 decimals but the USDC ERC-20 interface in 6.
// Deposits go through the ERC-20 interface, so 6 is correct here.
const USDC_DECIMALS = 6;
const AMOUNT = parseUnits(process.argv[2] ?? "5", USDC_DECIMALS);

const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const rawKey = env("EVM_PRIVATE_KEY") ?? env("HEDERA_BUYER_PRIVATE_KEY");
if (!rawKey) {
  throw new Error(
    "Set EVM_PRIVATE_KEY (or HEDERA_BUYER_PRIVATE_KEY — the same ECDSA key works)",
  );
}

const account = privateKeyToAccount(
  (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(),
});

async function main() {
  console.log(`account  ${account.address}`);
  console.log(`chain    ${arcTestnet.name} (${arcTestnet.id})`);
  console.log(`gateway  ${GATEWAY_WALLET}\n`);

  const [gas, balance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  console.log(`gas      ${formatEther(gas)}`);
  console.log(`USDC     ${formatUnits(balance, USDC_DECIMALS)}`);

  if (balance < AMOUNT) {
    console.error(
      `\nNeed ${formatUnits(AMOUNT, USDC_DECIMALS)} USDC but hold ` +
        `${formatUnits(balance, USDC_DECIMALS)}.\n` +
        `Fund ${account.address} at https://faucet.circle.com (select Arc testnet).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\napproving ${formatUnits(AMOUNT, USDC_DECIMALS)} USDC…`);
  const approvalTx = await walletClient.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [GATEWAY_WALLET, AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: approvalTx });
  console.log(`  ${approvalTx}`);

  // A plain ERC-20 transfer to the Gateway Wallet is NOT credited to the
  // unified balance — it has to go through deposit().
  console.log(`depositing…`);
  const depositTx = await walletClient.writeContract({
    address: GATEWAY_WALLET,
    abi: gatewayWalletAbi,
    functionName: "deposit",
    args: [USDC, AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  console.log(`  ${depositTx}`);

  console.log(`\ndeposited. Circle credits the unified balance after finality.`);
  console.log(`check: pnpm --filter buyer balance`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
