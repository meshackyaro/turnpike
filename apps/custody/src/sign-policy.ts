import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toHex } from "viem";
import { openDevice, approveOnDevice, DEFAULT_PATH } from "./device.js";
import { canonicalize, type SignedPolicy, type SpendPolicy } from "./policy.js";

const POLICY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../policy.signed.json",
);

const AGENT = process.argv[2] ?? "0xdF921eCa871EcF008ba27Cf4Bc1d3209A11C0ba9";

const policy: SpendPolicy = {
  version: 1,
  agent: AGENT,
  caps: {
    "hedera:testnet|0.0.0": "5000000", // 0.05 HBAR per call
    "eip155:5042002|0x3600000000000000000000000000000000000000": "50000", // 0.05 USDC
  },
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
};

async function main() {
  const { transport, eth } = await openDevice();

  try {
    const { address: deviceAddress } = await eth.getAddress(DEFAULT_PATH);
    console.log(`device   ${deviceAddress}`);
    console.log(`agent    ${AGENT}`);
    console.log(`caps`);
    for (const [k, v] of Object.entries(policy.caps)) {
      console.log(`         ${k}  <= ${v}`);
    }

    const message = canonicalize(policy);
    console.log(`\nasking the device to sign the policy…`);

    const signing = eth.signPersonalMessage(
      DEFAULT_PATH,
      Buffer.from(message).toString("hex"),
    );

    // Give the prompt a moment to render, show it, then confirm — the emulator's
    // stand-in for a human reading the screen and pressing both buttons.
    await new Promise((r) => setTimeout(r, 1200));
    const screens = await approveOnDevice();
    for (const s of screens) console.log(`  screen: ${s}`);

    const sig = await signing;
    const signature = `0x${sig.r}${sig.s}${sig.v.toString(16).padStart(2, "0")}` as const;

    const signed: SignedPolicy = {
      policy,
      signature,
      signer: deviceAddress,
    };
    writeFileSync(POLICY_PATH, JSON.stringify(signed, null, 2));

    console.log(`\nsigned by the device`);
    console.log(`  signature ${signature.slice(0, 26)}…`);
    console.log(`  written   ${POLICY_PATH.split("/").slice(-2).join("/")}`);
    console.log(
      `\nThe agent can read this policy and spend under it. It cannot produce a`,
    );
    console.log(`different one — only the device can.`);
    void toHex;
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
