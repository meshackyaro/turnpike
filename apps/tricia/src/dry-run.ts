import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWallet, HEDERA, ARC } from "@turnpike/wallet";
import { CATALOG, findService, buildUrl } from "./catalog.js";
import { loadPolicy } from "./ledger.js";

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`${name} is not set`);
  return v;
}

/**
 * Everything Tricia does except ask the model. Proves the tools she calls
 * actually work — policy verification, discovery, and a settled payment —
 * without spending API credits.
 */
async function main() {
  const loaded = await loadPolicy(
    process.env.PREFER?.toLowerCase() === "arc" ? [ARC, HEDERA] : [HEDERA, ARC],
  );
  console.log(`policy   ${loaded.source}`);
  if (loaded.signer) console.log(`  signer ${loaded.signer}`);
  console.log(`  prefers ${loaded.policy.preference.join(" > ")}`);
  for (const [k, v] of Object.entries(loaded.policy.caps)) {
    console.log(`  cap    ${k} <= ${v}`);
  }

  const wallet = createWallet({
    hederaAccountId: required("HEDERA_BUYER_ACCOUNT_ID"),
    privateKey: required("HEDERA_BUYER_PRIVATE_KEY"),
    policy: loaded.policy,
  });

  console.log(`\nsearch_services -> ${CATALOG.length} service(s)`);
  for (const s of CATALOG) console.log(`  ${s.id.padEnd(10)} ${s.name}`);

  const service = findService("forecast");
  if (!service) throw new Error("forecast service missing from catalog");

  const url = buildUrl(service, { symbol: "ETH" });
  console.log(`\ncall_service forecast -> ${url}`);

  const result = await wallet.fetchPaid<Record<string, unknown>>(url);
  console.log(`  settled on  ${result.route}`);
  console.log(`  why         ${result.reason}`);
  console.log(`  amount      ${result.amount}`);
  if (result.settlementRef) console.log(`  ref         ${result.settlementRef}`);
  if (result.skipped.length) console.log(`  skipped     ${result.skipped.join(", ")}`);
  console.log(`\n  ${JSON.stringify(result.body)}`);

  console.log(`\nTool path works. Only the model call is untested.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
