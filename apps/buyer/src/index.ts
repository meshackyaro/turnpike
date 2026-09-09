import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http as viemHttp } from "viem";
import { baseSepolia } from "viem/chains";
import { chooseRoute, type RoutePolicy, type RouteChoice } from "./selector.js";

// One .env at the workspace root; dotenv would otherwise look in this app's cwd.
config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

const RESOURCE =
  process.argv[2] ?? `http://localhost:${process.env.PORT ?? 4021}/forecast?symbol=ETH`;

const HEDERA: Network = "hedera:testnet";
const BASE: Network = "eip155:84532";
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function required(name: string): string {
  const value = process.env[name];
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

// The EVM route is only signable once a key exists. Until then the selector
// rejects it as unsignable rather than the payment failing halfway through.
const evmKey = process.env.EVM_PRIVATE_KEY;
let evmAddress: string | undefined;

if (evmKey) {
  const account = privateKeyToAccount(
    (evmKey.startsWith("0x") ? evmKey : `0x${evmKey}`) as `0x${string}`,
  );
  evmAddress = account.address;
  client.register(
    BASE,
    new ExactEvmScheme(
      toClientEvmSigner(
        account,
        createPublicClient({ chain: baseSepolia, transport: viemHttp() }),
      ),
    ),
  );
}

const policy: RoutePolicy = {
  preference: evmKey ? [HEDERA, BASE] : [HEDERA],
  caps: {
    [`${HEDERA}|0.0.0`]: "5000000", // 0.05 HBAR
    [`${BASE}|${USDC_BASE}`]: "50000", // 0.05 USDC
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
  console.log(`         evm    ${evmAddress ?? "(no key — Base route unsignable)"}`);
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
