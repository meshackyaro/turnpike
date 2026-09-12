import { openDevice, readScreen, DEFAULT_PATH } from "./device.js";

async function main() {
  const { transport, eth } = await openDevice();

  try {
    const screen = await readScreen();
    console.log(`device screen  ${screen.join(" / ") || "(blank)"}`);

    const { address, publicKey } = await eth.getAddress(DEFAULT_PATH);
    console.log(`path           ${DEFAULT_PATH}`);
    console.log(`address        ${address}`);
    console.log(`pubkey         ${publicKey.slice(0, 24)}…`);
    console.log(`\nThe signer holds this key. Nothing on disk does.`);
  } finally {
    await transport.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
