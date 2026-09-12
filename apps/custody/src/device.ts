import { createRequire } from "node:module";

// The Ledger packages ship an ESM build (lib-es) whose internal imports are
// extensionless, which Node's ESM loader rejects inside @ledgerhq/errors.
// Loading the CommonJS build sidesteps it entirely.
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeculosTransport: any =
  require("@ledgerhq/hw-transport-node-speculos").default ??
  require("@ledgerhq/hw-transport-node-speculos");
const Eth: any =
  require("@ledgerhq/hw-app-eth").default ?? require("@ledgerhq/hw-app-eth");

/** BIP-44 path for the first Ethereum account. */
export const DEFAULT_PATH = "44'/60'/0'/0/0";

export const SPECULOS_APDU_PORT = Number(process.env.SPECULOS_APDU_PORT ?? 9999);
export const SPECULOS_API_URL =
  process.env.SPECULOS_API_URL ?? "http://localhost:5000";

export interface Device {
  transport: { close(): Promise<void> };
  eth: any;
}

/**
 * Opens the emulated signer. Speculos is Ledger's official emulator, so the
 * signing path is the one a physical device takes; what it cannot emulate is a
 * human pressing the button, which approveOnDevice stands in for.
 */
export async function openDevice(): Promise<Device> {
  const transport = await SpeculosTransport.open({
    apduPort: SPECULOS_APDU_PORT,
  });
  return { transport, eth: new Eth(transport) };
}

/**
 * Walks the confirmation flow by reading the screen rather than pressing a
 * fixed number of times. Counting presses overshoots "Sign message" onto
 * "Reject" and the device answers 0x6985 — a denial, which looks like a bug in
 * the signing code rather than bad navigation.
 */
export async function approveOnDevice(maxSteps = 20): Promise<string[]> {
  const seen: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const screen = (await readScreen()).join(" ");
    if (screen) seen.push(screen);

    if (/sign message|approve|accept|confirm/i.test(screen)) {
      await press("both");
      return seen;
    }
    if (/reject|cancel|deny/i.test(screen)) {
      // Walked past the approve option — go back one rather than confirm a denial.
      await press("left");
      await new Promise((r) => setTimeout(r, 200));
      const back = (await readScreen()).join(" ");
      if (/sign message|approve|accept|confirm/i.test(back)) {
        await press("both");
        return [...seen, back];
      }
      throw new Error(`no approve step found; screens: ${seen.join(" | ")}`);
    }

    await press("right");
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`approve step never appeared; screens: ${seen.join(" | ")}`);
}

export async function press(button: "left" | "right" | "both"): Promise<void> {
  await fetch(`${SPECULOS_API_URL}/button/${button}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "press-and-release" }),
  });
}

/** What the device screen currently shows, for demoing the approval prompt. */
export async function readScreen(): Promise<string[]> {
  const res = await fetch(`${SPECULOS_API_URL}/events?currentscreenonly=true`);
  if (!res.ok) return [];
  const { events } = (await res.json()) as { events: Array<{ text: string }> };
  return events.map((e) => e.text);
}
