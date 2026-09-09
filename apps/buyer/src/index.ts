import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

// One .env at the workspace root; dotenv would otherwise look in this app's cwd.
config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

const RESOURCE =
  process.argv[2] ?? `http://localhost:${process.env.PORT ?? 4021}/forecast?symbol=ETH`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env`);
  return value;
}

/**
 * Portal keys are raw hex, which carries no type marker — fromString() would
 * have to guess. The accounts are ECDSA, so say so explicitly.
 */
function parseKey(raw: string): PrivateKey {
  return PrivateKey.fromStringECDSA(raw.replace(/^0x/, ""));
}

const accountId = required("HEDERA_BUYER_ACCOUNT_ID");
const signer = createClientHederaSigner(
  accountId,
  parseKey(required("HEDERA_BUYER_PRIVATE_KEY")),
  { network: "hedera:testnet" },
);

const client = new x402Client().register(
  "hedera:*",
  new ExactHederaScheme(signer),
);

// Spend controls are on by default and allow only recognized default assets,
// which excludes native HBAR. Allowlisting it explicitly — with a hard atomic
// cap — is the first version of the policy the Ledger signer will later sign.
const MAX_PER_CALL_TINYBARS = "5000000"; // 0.05 HBAR

client.setSpendControls({
  allowedAssets: [
    {
      network: "hedera:testnet",
      asset: "0.0.0",
      maxAmountPerPayment: MAX_PER_CALL_TINYBARS,
    },
  ],
});

client.onPaymentCreationFailure(async (ctx) => {
  console.error("payment creation failed:", JSON.stringify(ctx, null, 2));
});

const http = new x402HTTPClient(client);

function tinybars(amount: string): string {
  return `${Number(amount) / 1e8} HBAR`;
}

async function main() {
  console.log(`buyer   ${accountId}`);
  console.log(`GET     ${RESOURCE}\n`);

  const unpaid = await fetch(RESOURCE);

  if (unpaid.status !== 402) {
    console.log(`no payment required (HTTP ${unpaid.status})`);
    console.log(await unpaid.text());
    return;
  }

  const required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n));

  console.log(`402 — ${required.accepts.length} route(s) offered:`);
  for (const option of required.accepts) {
    const price = "amount" in option ? tinybars(String(option.amount)) : "?";
    const feePayer = (option.extra as { feePayer?: string } | undefined)?.feePayer;
    console.log(`  ${option.network}  ${price} -> ${option.payTo}`);
    if (feePayer) console.log(`    gas sponsored by facilitator ${feePayer}`);
  }

  // handlePaymentRequired() only runs registered hooks and returns null when
  // none produce headers; creating the payment is these two calls.
  const payload = await http.createPaymentPayload(required);
  const headers = http.encodePaymentSignatureHeader(payload);

  console.log(`\npaying…`);
  const paid = await fetch(RESOURCE, { headers });

  if (!paid.ok) {
    console.error(`payment rejected (HTTP ${paid.status})`);
    console.error(await paid.text());
    process.exitCode = 1;
    return;
  }

  const settlement = http.getPaymentSettleResponse((n) => paid.headers.get(n));
  const body = await paid.json();

  console.log(`\nHTTP ${paid.status} — settled`);
  if (settlement?.transaction) {
    console.log(`  tx      ${settlement.transaction}`);
    console.log(
      `  explorer https://hashscan.io/testnet/transaction/${settlement.transaction}`,
    );
  }
  console.log(`\n${JSON.stringify(body, null, 2)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
