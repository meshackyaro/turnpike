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
import { HEDERA_TESTNET_CAIP2, HBAR_ASSET_ID } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
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

const app = express();

app.use(
  paymentMiddlewareFromConfig(
    {
      "GET /forecast": {
        description: "24h drift and volatility band for a symbol",
        serviceName: "turnpike/forecast",
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact",
            network: HEDERA_TESTNET_CAIP2,
            payTo: PAY_TO,
            price: { asset: HBAR_ASSET_ID, amount: "1200000" },
            maxTimeoutSeconds: 60,
          },
          // Arc/USDC route lands here on Sept 11 — a second entry, not a second server.
        ],
      },
    },
    facilitator,
    // Without a registered scheme the server can price a route but cannot turn
    // that price into payment requirements, and protected routes 500 instead of 402.
    [{ network: HEDERA_TESTNET_CAIP2, server: new ExactHederaScheme() }],
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
  console.log(`  paying to   ${PAY_TO} on ${HEDERA_TESTNET_CAIP2}`);
  console.log(`  facilitator ${FACILITATOR_URL}`);
});
