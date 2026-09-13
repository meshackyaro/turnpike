import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createWallet, HEDERA, ARC } from "@turnpike/wallet";
import { CATALOG, findService, buildUrl, appendActivity } from "@turnpike/wallet";
import { loadPolicy } from "./ledger.js";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

function required(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set — see .env`);
  return v;
}

const QUESTION =
  process.argv.slice(2).join(" ") ||
  "Should I be worried about my ETH position over the next day?";

/** Hard ceiling for the whole run, independent of any per-call cap. */
const RUN_BUDGET_USD = Number(env("TRICIA_BUDGET_USD") ?? "0.05");

const spend: Array<{ service: string; route: string; usd: number }> = [];

function usdFor(route: string, amount: string): number {
  // HBAR is 8 decimals, USDC 6. Testnet HBAR has no meaningful price, so it is
  // valued at the seller's own USDC quote for the same call — good enough to
  // give the model one comparable number to reason about.
  return route === HEDERA ? Number(amount) / 1e8 * 0.0335 : Number(amount) / 1e6;
}

const spentUsd = () => spend.reduce((t, s) => t + s.usd, 0);
const remainingUsd = () => Math.max(0, RUN_BUDGET_USD - spentUsd());

async function main() {
  const loaded = await loadPolicy(
    env("PREFER")?.toLowerCase() === "arc" ? [ARC, HEDERA] : [HEDERA, ARC],
  );

  const wallet = createWallet({
    hederaAccountId: required("HEDERA_BUYER_ACCOUNT_ID"),
    privateKey: required("HEDERA_BUYER_PRIVATE_KEY"),
    policy: loaded.policy,
  });

  console.log(`Tricia`);
  console.log(`  hedera   ${wallet.hederaAccount}`);
  console.log(`  evm      ${wallet.agentAddress}`);
  console.log(
    `  policy   ${loaded.source === "device" ? `signed by device ${loaded.signer}` : "unsigned fallback"}`,
  );
  console.log(`  prefers  ${loaded.policy.preference.join(" > ")}`);
  console.log(`  budget   $${RUN_BUDGET_USD.toFixed(4)}`);
  console.log(`\nQ: ${QUESTION}\n`);

  appendActivity({ kind: "question", text: QUESTION });

  const searchServices = betaZodTool({
    name: "search_services",
    description:
      "List the paid services available on the Turnpike marketplace, with " +
      "what each returns and the parameters it accepts. Call this first.",
    inputSchema: z.object({}),
    run: async () => {
      appendActivity({
        kind: "tool",
        text: "search_services",
        detail: `${CATALOG.length} service(s) listed`,
      });
      return JSON.stringify(
        CATALOG.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          params: s.params,
        })),
      );
    },
  });

  const callService = betaZodTool({
    name: "call_service",
    description:
      "Call a paid service. Payment settles automatically on whichever route " +
      "the signed spend policy selects; you do not choose the chain. The " +
      "result includes what it cost and what budget remains — if the budget " +
      "is nearly spent, stop and answer with what you have.",
    inputSchema: z.object({
      serviceId: z.string().describe("id from search_services"),
      args: z.record(z.string(), z.string()).describe("query parameters for the service"),
    }),
    run: async ({ serviceId, args }) => {
      const service = findService(serviceId);
      if (!service) {
        return JSON.stringify({ error: `no such service: ${serviceId}` });
      }
      if (remainingUsd() <= 0) {
        return JSON.stringify({
          error: "run budget exhausted; answer with what you already have",
        });
      }

      const result = await wallet.fetchPaid(buildUrl(service, args));
      const usd = usdFor(result.route, result.amount);
      spend.push({ service: serviceId, route: result.route, usd });

      console.log(
        `  paid  ${serviceId.padEnd(10)} ${result.route.padEnd(16)} ` +
          `$${usd.toFixed(5)}  (${result.reason})`,
      );
      if (result.skipped.length) {
        console.log(`        skipped ${result.skipped.join(", ")}: no signer`);
      }

      appendActivity({
        kind: "tool",
        text: `call_service ${serviceId}`,
        detail: `settled on ${result.route} for $${usd.toFixed(5)} — ${result.reason}`,
      });

      return JSON.stringify({
        result: result.body,
        settledOn: result.route,
        whyThatRoute: result.reason,
        costUsd: Number(usd.toFixed(5)),
        budgetRemainingUsd: Number(remainingUsd().toFixed(5)),
      });
    },
  });

  const client = new Anthropic();

  const answer = await client.beta.messages.toolRunner({
    model: "claude-opus-5",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You are Tricia, an agent that buys data to answer questions. You hold " +
      "a small budget and pay per call. Buy only what the question needs, and " +
      "say plainly what you bought, what it cost, and how confident the " +
      "answer is. If the data is thin, say so rather than padding.",
    tools: [searchServices, callService],
    messages: [{ role: "user", content: QUESTION }],
  });

  const text = answer.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  appendActivity({
    kind: "answer",
    text,
    detail: `$${spentUsd().toFixed(5)} across ${spend.length} call(s)`,
  });

  console.log(`\n${text}\n`);
  console.log(`spent $${spentUsd().toFixed(5)} across ${spend.length} call(s)`);
  for (const s of spend) {
    console.log(`  ${s.service.padEnd(10)} ${s.route.padEnd(16)} $${s.usd.toFixed(5)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
