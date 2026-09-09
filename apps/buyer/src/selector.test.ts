import assert from "node:assert/strict";
import type { PaymentRequirements } from "@x402/core/types";
import { chooseRoute, type RoutePolicy } from "./selector.js";

const HEDERA = "hedera:testnet";
const BASE = "eip155:84532";
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const req = (
  network: string,
  asset: string,
  amount: string,
): PaymentRequirements =>
  ({
    scheme: "exact",
    network,
    asset,
    amount,
    payTo: "0.0.1",
    maxTimeoutSeconds: 60,
  }) as PaymentRequirements;

const policy: RoutePolicy = {
  preference: [HEDERA, BASE],
  caps: {
    [`${HEDERA}|0.0.0`]: "5000000",
    [`${BASE}|${USDC_BASE}`]: "50000",
  },
};

// Preference order decides when both routes pass.
{
  const { chosen, reason } = chooseRoute(policy, [
    req(BASE, USDC_BASE, "4000"),
    req(HEDERA, "0.0.0", "1200000"),
  ]);
  assert.equal(chosen.network, HEDERA);
  assert.match(reason, /preferred over eip155:84532/);
}

// Flipping preference flips the chain, with no other change.
{
  const flipped: RoutePolicy = { ...policy, preference: [BASE, HEDERA] };
  const { chosen } = chooseRoute(flipped, [
    req(BASE, USDC_BASE, "4000"),
    req(HEDERA, "0.0.0", "1200000"),
  ]);
  assert.equal(chosen.network, BASE);
}

// A route over its cap is skipped, not chosen and then rejected downstream.
{
  const { chosen, rejected } = chooseRoute(policy, [
    req(HEDERA, "0.0.0", "9000000"),
    req(BASE, USDC_BASE, "4000"),
  ]);
  assert.equal(chosen.network, BASE);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /over cap/);
}

// Networks with no signer are ignored even when cheapest.
{
  const { chosen, rejected } = chooseRoute(policy, [
    req("solana:devnet", "USDC", "1"),
    req(HEDERA, "0.0.0", "1200000"),
  ]);
  assert.equal(chosen.network, HEDERA);
  assert.match(rejected[0].reason, /no signer/);
}

// Nothing viable fails loudly, naming every rejection.
{
  assert.throws(
    () => chooseRoute(policy, [req(HEDERA, "0.0.0", "9000000")]),
    /no route passed policy.*over cap/s,
  );
}

console.log("selector: 5/5 passed");
