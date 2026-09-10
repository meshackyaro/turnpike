import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { registerBatchScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { chooseRoute, type RoutePolicy, type RouteChoice } from "./selector.js";

// One .env at the workspace root; dotenv would otherwise look in this app's cwd.
config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

const RESOURCE =
  process.argv[2] ?? `http://localhost:${process.env.PORT ?? 4021}/forecast?symbol=ETH`;

const HEDERA: Network = "hedera:testnet";
const ARC: Network = (process.env.ARC_NETWORK ?? "eip155:5042002") as Network;
const USDC_ARC =
  process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";


/** `??` does not fall through on an empty string, and blank vars are the normal
 * state of a half-filled .env — so treat empty as absent. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

function required(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set — see .env`);
  return value;
}

/**
 * Portal keys are raw hex, which carries no type marker — fromString() would
 * have to guess. The accounts are ECDSA, so say so explicitly.
 */
function parseHederaKey(raw: string): PrivateKey {
  return PrivateKey.fromStringECDSA(raw.replace(/^0x/, ""));
}

const hederaAccount = required("HEDERA_BUYER_ACCOUNT_ID");
const client = new x402Client(selectRoute).register(
  HEDERA,
  new ExactHederaScheme(
    createClientHederaSigner(
      hederaAccount,
      parseHederaKey(required("HEDERA_BUYER_PRIVATE_KEY")),
      { network: HEDERA },
    ),
  ),
);

// Same ECDSA key as Hedera — EVM keys are not chain-specific, so the buyer's
// Hedera key already derives its Arc address. No separate key to configure.
const evmKey = env("EVM_PRIVATE_KEY") ?? env("HEDERA_BUYER_PRIVATE_KEY");
let evmAddress: string | undefined;

if (evmKey) {
  const account = privateKeyToAccount(
    (evmKey.startsWith("0x") ? evmKey : `0x${evmKey}`) as `0x${string}`,
  );
  evmAddress = account.address;

  // Not ExactEvmScheme: Arc settles through Circle Gateway's batched scheme,
  // and @x402/evm only speaks EIP-3009 and Permit2. Its server half also
  // discards the facilitator's EIP-712 domain (`void supportedKind`), and Arc
  // is absent from its default-asset table, so the domain never arrives and
  // signing fails. This package is the one that speaks GatewayWalletBatched.
  registerBatchScheme(client, { signer: account, networks: [ARC] });
}

// The one value that decides which chain settles. PREFER=arc flips it, and
// nothing else in the run changes — that is the demo.
const preference =
  env("PREFER")?.toLowerCase() === "arc" ? [ARC, HEDERA] : [HEDERA, ARC];

const policy: RoutePolicy = {
  preference: evmKey ? preference : [HEDERA],
  caps: {
    [`${HEDERA}|0.0.0`]: "5000000", // 0.05 HBAR
    [`${ARC}|${USDC_ARC}`]: "50000", // 0.05 USDC
  },
};

let lastChoice: RouteChoice | undefined;
// x402Client filters accepts down to networks with a registered scheme before
// the selector runs, so these two lists differ and the demo should say which
// routes the policy actually weighed.
let consideredNetworks: string[] = [];

function selectRoute(
  _version: number,
  offered: PaymentRequirements[],
): PaymentRequirements {
  consideredNetworks = offered.map((o) => o.network);
  lastChoice = chooseRoute(policy, offered);
  return lastChoice.chosen;
}

client.setSpendControls({
  allowedAssets: Object.entries(policy.caps).map(([key, maxAmountPerPayment]) => {
    const [network, asset] = key.split("|");
    return { network: network as Network, asset, maxAmountPerPayment };
  }),
});

const http = new x402HTTPClient(client);

const fmt = (r: PaymentRequirements) =>
  r.network === HEDERA
    ? `${Number(r.amount) / 1e8} HBAR`
    : `${Number(r.amount) / 1e6} USDC`;

async function main() {
  console.log(`buyer    hedera ${hederaAccount}`);
  console.log(`         evm    ${evmAddress ?? "(no key)"}`);
  console.log(`policy   prefer ${policy.preference.join(" > ")}`);
  console.log(`GET      ${RESOURCE}\n`);

  const unpaid = await fetch(RESOURCE);

  if (unpaid.status !== 402) {
    console.log(`no payment required (HTTP ${unpaid.status})`);
    console.log(await unpaid.text());
    return;
  }

  const required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n));

  console.log(`402 — ${required.accepts.length} route(s) offered:`);
  for (const option of required.accepts) {
    const feePayer = (option.extra as { feePayer?: string } | undefined)?.feePayer;
    console.log(
      `  ${option.network.padEnd(16)} ${fmt(option)} -> ${option.payTo}` +
        (feePayer ? `  (gas: ${feePayer})` : ""),
    );
  }

  // handlePaymentRequired() only runs registered hooks and returns null when
  // none produce headers; creating the payment is these two calls. The selector
  // runs inside createPaymentPayload, so lastChoice is populated after it.
  const payload = await http.createPaymentPayload(required);
  const headers = http.encodePaymentSignatureHeader(payload);

  for (const option of required.accepts) {
    if (!consideredNetworks.includes(option.network)) {
      console.log(`\n  skipped  ${option.network}: no registered signer`);
    }
  }

  if (lastChoice) {
    console.log(
      `\nselector weighed ${consideredNetworks.length} of ${required.accepts.length} route(s)`,
    );
    console.log(`  chose    ${lastChoice.chosen.network} — ${lastChoice.reason}`);
    for (const r of lastChoice.rejected) {
      console.log(`  rejected ${r.requirement.network}: ${r.reason}`);
    }
  }

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

  console.log(`\nHTTP ${paid.status} — settled on ${lastChoice?.chosen.network}`);
  if (settlement?.transaction) {
    console.log(`  tx      ${settlement.transaction}`);
  }
  console.log(`\n${JSON.stringify(body, null, 2)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
