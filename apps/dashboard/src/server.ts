import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync, watch } from "node:fs";
import express from "express";
import {
  readReceipts,
  readActivity,
  RECEIPTS_LOG,
  ACTIVITY_LOG,
  verifyPolicy,
  CATALOG,
  buildUrl,
  type SignedPolicy,
} from "@turnpike/wallet";

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

  // Re-run verification against a copy whose cap has been raised 100x. Showing
  // the refusal is the point of the custody split, and asserting it live beats
  // asserting it in a README.
  const firstCap = Object.keys(signed.policy.caps)[0];
  const tampered: SignedPolicy = {
    ...signed,
    policy: {
      ...signed.policy,
      caps: {
        ...signed.policy.caps,
        [firstCap]: String(BigInt(signed.policy.caps[firstCap]) * 100n),
      },
    },
  };
  const tamperVerdict = await verifyPolicy(tampered, signed.signer);

  return {
    source: "device" as const,
    verified: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    caps: signed.policy.caps,
    signer: signed.signer,
    agent: signed.policy.agent,
    expiresAt: signed.policy.expiresAt,
    tamper: {
      cap: firstCap,
      from: signed.policy.caps[firstCap],
      to: tampered.policy.caps[firstCap],
      refused: !tamperVerdict.ok,
      reason: tamperVerdict.ok ? null : tamperVerdict.reason,
    },
  };
}

/**
 * Asks each service what it costs, exactly as a buyer would, and reports the
 * routes it advertises. This is the multi-route claim rendered rather than
 * described — the alternative was pointing at devtools during the demo.
 */
async function servicesState() {
  return Promise.all(
    CATALOG.map(async (service) => {
      const url = buildUrl(service, { symbol: "ETH" });
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.status !== 402) {
          return { ...service, reachable: res.ok, routes: [], note: `HTTP ${res.status}` };
        }
        const header = res.headers.get("payment-required");
        if (!header) return { ...service, reachable: true, routes: [], note: "no header" };
        const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
        return {
          ...service,
          reachable: true,
          note: null,
          routes: (decoded.accepts ?? []).map(
            (a: Record<string, unknown> & { extra?: Record<string, unknown> }) => ({
              network: a.network,
              amount: a.amount,
              asset: a.asset,
              payTo: a.payTo,
              feePayer: a.extra?.feePayer ?? null,
              scheme: a.extra?.name ?? a.scheme,
            }),
          ),
        };
      } catch (error) {
        return {
          ...service,
          reachable: false,
          routes: [],
          note: error instanceof Error ? error.message : "unreachable",
        };
      }
    }),
  );
}

// Services are probed on their own cadence: each probe is a network round trip
// per service, and the feed must stay instant.
let services: Awaited<ReturnType<typeof servicesState>> = [];
async function refreshServices() {
  try { services = await servicesState(); } catch { /* keep the last good list */ }
}

async function snapshot() {
  return {
    receipts: readReceipts(),
    activity: readActivity(),
    policy: await policyState(),
    services,
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
  void ACTIVITY_LOG;
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

await refreshServices();
setInterval(() => void refreshServices(), 10_000);

app.listen(PORT, () => {
  console.log(`dashboard  http://localhost:${PORT}`);
  console.log(`  receipts ${RECEIPTS_LOG}`);
  console.log(`  budget   $${BUDGET_USD}`);
});
