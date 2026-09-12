import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyPolicy, type SignedPolicy } from "@turnpike/wallet";

const POLICY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../policy.signed.json",
);

const HEDERA_CAP = "hedera:testnet|0.0.0";

async function main() {
  const signed = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as SignedPolicy;

  console.log(`device  ${signed.signer}`);
  console.log(`agent   ${signed.policy.agent}\n`);

  // 1. The policy as the device signed it.
  const asSigned = await verifyPolicy(signed, signed.signer);
  console.log(`as signed`);
  console.log(`  cap ${HEDERA_CAP} = ${signed.policy.caps[HEDERA_CAP]}`);
  console.log(
    asSigned.ok
      ? `  ACCEPTED — the agent may spend under this`
      : `  REFUSED — ${asSigned.reason}`,
  );

  // 2. The agent rewrites its own ceiling, 100x, and presents that instead.
  const tampered: SignedPolicy = {
    ...signed,
    policy: {
      ...signed.policy,
      caps: { ...signed.policy.caps, [HEDERA_CAP]: "500000000" },
    },
  };

  const afterEdit = await verifyPolicy(tampered, signed.signer);
  console.log(`\nafter the agent raises its own ceiling`);
  console.log(`  cap ${HEDERA_CAP} = ${tampered.policy.caps[HEDERA_CAP]}`);
  console.log(
    afterEdit.ok
      ? `  ACCEPTED — which would be a hole`
      : `  REFUSED — ${afterEdit.reason}`,
  );

  const correct = asSigned.ok && !afterEdit.ok;
  console.log(
    correct
      ? `\nThe process can spend up to its ceiling and cannot move it. Only the device can.`
      : `\nUNEXPECTED — custody split is not holding`,
  );
  if (!correct) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
