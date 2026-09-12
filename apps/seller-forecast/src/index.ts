import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express from "express";

// One .env at the workspace root; dotenv would otherwise look in this app's cwd.
config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { HEDERA_TESTNET_CAIP2, HBAR_ASSET_ID } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { GatewayEvmScheme } from "@circle-fin/x402-batching/server";
import { forecast } from "./forecast.js";

const PORT = Number(process.env.PORT ?? 4021);
const PAY_TO = required("HEDERA_ACCOUNT_ID");
const FACILITATOR_URL = required("X402_FACILITATOR_URL");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — copy .env.example to .env`);
  return value;
}

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// The package exports these as plain strings; Network is a `${string}:${string}`.
const HEDERA: Network = HEDERA_TESTNET_CAIP2 as Network;
const ARC: Network = (process.env.ARC_NETWORK ?? "eip155:5042002") as Network;
const USDC_ARC =
  process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";

// Hedera settles through the default x402 facilitator; Arc through Circle
// Gateway's, which is the one that advertises eip155:5042002. The middleware
// takes an array, so each route uses whichever facilitator supports it.
const CIRCLE_FACILITATOR_URL = process.env.CIRCLE_FACILITATOR_URL;

// A second route is only honest if we can actually be paid on it.
const EVM_PAY_TO = process.env.EVM_ADDRESS;

const routes: PaymentOption[] = [
  {
    scheme: "exact" as const,
    network: HEDERA,
    payTo: PAY_TO,
    price: { asset: HBAR_ASSET_ID, amount: "1200000" },
    maxTimeoutSeconds: 60,
  },
  ...(EVM_PAY_TO
    ? [
        {
          scheme: "exact" as const,
          network: ARC,
          payTo: EVM_PAY_TO,
          price: { asset: USDC_ARC, amount: "4000" },
          maxTimeoutSeconds: 60,
        },
      ]
    : []),
];

const schemes = [
  { network: HEDERA, server: new ExactHederaScheme() },
  // GatewayEvmScheme, not ExactEvmScheme: it advertises the EIP-712 domain
  // (name/version) the Circle batching client requires. ExactEvmScheme discards
  // the facilitator metadata and Arc is not in its default-asset table.
  { network: ARC, server: new GatewayEvmScheme() },
];

const facilitators = [
  facilitator,
  ...(CIRCLE_FACILITATOR_URL
    ? [new HTTPFacilitatorClient({ url: CIRCLE_FACILITATOR_URL })]
    : []),
];

/**
 * One transient fetch failure during the middleware's startup sync makes it
 * conclude a network is unsupported, and it throws RouteConfigurationError and
 * kills the process. Confirming the facilitators answer first turns a flaky
 * boot into a slow one.
 */
async function waitForFacilitators(urls: string[], attempts = 6): Promise<void> {
  for (const url of urls) {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${url}/supported`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          lastError = undefined;
          break;
        }
        lastError = new Error(`HTTP ${res.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
    if (lastError) {
      throw new Error(
        `facilitator ${url} unreachable after ${attempts} attempts: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    }
    console.log(`  facilitator ok  ${url}`);
  }
}

const app = express();

await waitForFacilitators([
  FACILITATOR_URL,
  ...(CIRCLE_FACILITATOR_URL ? [CIRCLE_FACILITATOR_URL] : []),
]);

app.use(
  paymentMiddlewareFromConfig(
    {
      "GET /forecast": {
        description: "24h drift and volatility band for a symbol",
        serviceName: "turnpike/forecast",
        mimeType: "application/json",
        accepts: routes,
      },
    },
    facilitators,
    // Without a registered scheme the server can price a route but cannot turn
    // that price into payment requirements, and protected routes 500 instead of 402.
    schemes,
  ),
);

app.get("/forecast", (req, res) => {
  const symbol = String(req.query.symbol ?? "ETH");
  const horizon = Number(req.query.horizonHours ?? 24);

  if (!/^[A-Za-z]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: "symbol must be 1-10 letters" });
  }
  if (!Number.isFinite(horizon) || horizon <= 0 || horizon > 720) {
    return res.status(400).json({ error: "horizonHours must be 1-720" });
  }

  res.json(forecast(symbol, horizon));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[seller] unhandled:", err?.stack ?? err);
    res.status(500).json({ error: err?.message ?? "Internal Server Error" });
  },
);

app.listen(PORT, () => {
  console.log(`seller-forecast listening on :${PORT}`);
  console.log(`  paid route  GET /forecast?symbol=ETH`);
  console.log(`  facilitators ${facilitators.length}`);
  console.log(`  offering ${routes.length} route(s):`);
  for (const r of routes) {
    const price =
      typeof r.price === "object" && "amount" in r.price
        ? `${r.price.amount} ${r.price.asset}`
        : String(r.price);
    console.log(`    ${r.network.padEnd(16)} ${price} -> ${String(r.payTo)}`);
  }
  if (!EVM_PAY_TO) {
    console.log(`  (set EVM_ADDRESS to advertise the Arc route)`);
  }
});
