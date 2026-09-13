import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync, watch } from "node:fs";
import express from "express";
import { readReceipts, RECEIPTS_LOG, verifyPolicy, type SignedPolicy } from "@turnpike/wallet";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(HERE, "../../../.env") });

const PORT = Number(process.env.DASHBOARD_PORT ?? 4100);
const SIGNED_POLICY = resolve(HERE, "../../custody/policy.signed.json");
const BUDGET_USD = Number(process.env.TRICIA_BUDGET_USD ?? "0.05");

async function policyState() {
  if (!existsSync(SIGNED_POLICY)) {
    return { source: "none" as const, verified: false, caps: {}, signer: null };
  }
  const signed = JSON.parse(readFileSync(SIGNED_POLICY, "utf8")) as SignedPolicy;
  const verdict = await verifyPolicy(signed, signed.signer);
  return {
    source: "device" as const,
    verified: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    caps: signed.policy.caps,
    signer: signed.signer,
    agent: signed.policy.agent,
    expiresAt: signed.policy.expiresAt,
  };
}

async function snapshot() {
  return {
    receipts: readReceipts(),
    policy: await policyState(),
    budgetUsd: BUDGET_USD,
  };
}

const app = express();
app.use(express.static(resolve(HERE, "../public")));

app.get("/api/state", async (_req, res) => {
  res.json(await snapshot());
});

/**
 * Server-sent events rather than polling: a settlement should appear the moment
 * it lands, because the whole point of the screen is watching money move.
 */
app.get("/api/stream", async (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const push = async () => {
    res.write(`data: ${JSON.stringify(await snapshot())}\n\n`);
  };
  await push();

  // The log may not exist until the first payment, so watch the directory.
  const dir = dirname(RECEIPTS_LOG);
  let debounce: NodeJS.Timeout | undefined;
  const watcher = existsSync(dir)
    ? watch(dir, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void push(), 120);
      })
    : undefined;

  const keepAlive = setInterval(() => res.write(`: ping\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clearTimeout(debounce);
    watcher?.close();
  });
});

app.listen(PORT, () => {
  console.log(`dashboard  http://localhost:${PORT}`);
  console.log(`  receipts ${RECEIPTS_LOG}`);
  console.log(`  budget   $${BUDGET_USD}`);
});
