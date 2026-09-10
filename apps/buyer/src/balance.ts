import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
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

const ARC_DOMAIN = 26; // Gateway domain id for Arc testnet
const GATEWAY_API =
  env("CIRCLE_FACILITATOR_URL")?.replace(/\/x402\/?$/, "") ??
  "https://gateway-api-testnet.circle.com/v1";
const USDC = (env("ARC_USDC_ADDRESS") ??
  "0x3600000000000000000000000000000000000000") as `0x${string}`;

const rawKey = env("EVM_PRIVATE_KEY") ?? env("HEDERA_BUYER_PRIVATE_KEY");
if (!rawKey) throw new Error("Set EVM_PRIVATE_KEY or HEDERA_BUYER_PRIVATE_KEY");

const account = privateKeyToAccount(
  (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

async function main() {
  const [gas, wallet] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  console.log(`account  ${account.address}\n`);
  console.log(`on Arc testnet`);
  console.log(`  gas          ${formatEther(gas)}`);
  console.log(`  USDC wallet  ${formatUnits(wallet, 6)}`);

  const response = await fetch(`${GATEWAY_API}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: [{ domain: ARC_DOMAIN, depositor: account.address }],
    }),
  });

  if (!response.ok) {
    console.error(`\ngateway /balances -> HTTP ${response.status}`);
    console.error(await response.text());
    process.exitCode = 1;
    return;
  }

  const { balances } = (await response.json()) as {
    balances: Array<{ domain: number; depositor: string; balance: string }>;
  };

  console.log(`\nin Circle Gateway`);
  for (const b of balances) {
    console.log(`  domain ${b.domain}    ${b.balance} USDC`);
  }

  const total = balances.reduce((sum, b) => sum + Number(b.balance), 0);
  console.log(
    total > 0
      ? `\nGateway balance is what the Arc route spends from.`
      : `\nNothing deposited yet — the Arc route cannot settle until it is.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
