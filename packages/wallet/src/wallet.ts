import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { registerBatchScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { chooseRoute, type RouteChoice, type RoutePolicy } from "./selector.js";
import { appendReceipt } from "./receipts.js";

export const HEDERA: Network = "hedera:testnet";
export const ARC: Network = "eip155:5042002";
export const USDC_ARC = "0x3600000000000000000000000000000000000000";

export interface PaidResult<T = unknown> {
  body: T;
  /** Which network settled, and why the policy chose it. */
  route: string;
  reason: string;
  /** Atomic units paid on that route. */
  amount: string;
  settlementRef?: string;
  /** Routes the seller offered that never reached the policy. */
  skipped: string[];
}

export interface Wallet {
  agentAddress: string;
  hederaAccount: string;
  policy: RoutePolicy;
  fetchPaid<T = unknown>(url: string): Promise<PaidResult<T>>;
}

export interface WalletConfig {
  hederaAccountId: string;
  /** Raw hex ECDSA key. The same key signs for Hedera and every EVM chain. */
  privateKey: string;
  policy: RoutePolicy;
}

/**
 * HBAR is 8 decimals, USDC 6. Testnet HBAR has no market price, so it is valued
 * at the seller's own USDC quote for the same call — enough to put both routes
 * on one axis without implying the number is a real exchange rate.
 */
export function toUsd(route: string, amount: string): number {
  return route === HEDERA ? (Number(amount) / 1e8) * 0.0335 : Number(amount) / 1e6;
}

const normalize = (key: string) =>
  (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;

export function createWallet(config: WalletConfig): Wallet {
  const account = privateKeyToAccount(normalize(config.privateKey));

  let lastChoice: RouteChoice | undefined;
  let considered: string[] = [];

  const client = new x402Client((_version, offered: PaymentRequirements[]) => {
    considered = offered.map((o) => o.network);
    lastChoice = chooseRoute(config.policy, offered);
    return lastChoice.chosen;
  }).register(
    HEDERA,
    new ExactHederaScheme(
      createClientHederaSigner(
        config.hederaAccountId,
        // Portal keys are raw hex with no type marker, and these accounts are
        // ECDSA — fromString() would have to guess.
        PrivateKey.fromStringECDSA(config.privateKey.replace(/^0x/, "")),
        { network: HEDERA },
      ),
    ),
  );

  registerBatchScheme(client, { signer: account, networks: [ARC] });

  client.setSpendControls({
    allowedAssets: Object.entries(config.policy.caps).map(
      ([key, maxAmountPerPayment]) => {
        const [network, asset] = key.split("|");
        return { network: network as Network, asset, maxAmountPerPayment };
      },
    ),
  });

  const http = new x402HTTPClient(client);

  return {
    agentAddress: account.address,
    hederaAccount: config.hederaAccountId,
    policy: config.policy,

    async fetchPaid<T>(url: string): Promise<PaidResult<T>> {
      const unpaid = await fetch(url);

      if (unpaid.status !== 402) {
        // A failed request is not free data. Returning an error body as though
        // it were a result lets the model reason over a 500 page.
        if (!unpaid.ok) {
          throw new Error(
            `service returned HTTP ${unpaid.status}: ${(await unpaid.text()).slice(0, 200)}`,
          );
        }
        return {
          body: (await unpaid.json()) as T,
          route: "none",
          reason: "no payment required",
          amount: "0",
          skipped: [],
        };
      }

      const required = http.getPaymentRequiredResponse((n) =>
        unpaid.headers.get(n),
      );
      const payload = await http.createPaymentPayload(required);
      const headers = http.encodePaymentSignatureHeader(payload);

      const paid = await fetch(url, { headers });
      if (!paid.ok) {
        // A rejection re-sends PAYMENT-REQUIRED, whose `error` field says why.
        // Without it the failure is just "402" and tells you nothing.
        let detail = "";
        try {
          const again = http.getPaymentRequiredResponse((n) =>
            paid.headers.get(n),
          );
          detail = (again as { error?: string }).error ?? "";
        } catch {
          detail = (await paid.text()).slice(0, 200);
        }
        throw new Error(
          `payment rejected (HTTP ${paid.status})${detail ? `: ${detail}` : ""}`,
        );
      }

      const settlement = http.getPaymentSettleResponse((n) =>
        paid.headers.get(n),
      );

      const route = lastChoice?.chosen.network ?? "unknown";
      const amount = lastChoice?.chosen.amount ?? "0";
      const skipped = required.accepts
        .map((a) => a.network)
        .filter((n) => !considered.includes(n));

      appendReceipt({
        at: new Date().toISOString(),
        service: new URL(url).pathname.replace(/^\//, "") || "unknown",
        route,
        amount,
        asset: lastChoice?.chosen.asset ?? "",
        usd: toUsd(route, amount),
        reason: lastChoice?.reason ?? "",
        settlementRef: settlement?.transaction,
        skipped,
      });

      return {
        body: (await paid.json()) as T,
        route,
        reason: lastChoice?.reason ?? "",
        amount,
        settlementRef: settlement?.transaction,
        skipped,
      };
    },
  };
}
