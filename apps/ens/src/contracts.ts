import type { Address } from "viem";

/** ENSv2 beta on Sepolia. Verified deployed 2026-09-11. */
export const ENSV2 = {
  ethRegistry: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2",
  ethRegistrar: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
  publicResolver: "0xe7b9a25607e02da8145e4eb1836ca539e53f11f7",
  universalResolver: "0x4a1817d13e9cf196f471725176355c1234b63c70",
} as const satisfies Record<string, Address>;

/** Circle's Sepolia USDC. The ENSv2 registrar charges in stablecoin, not ETH. */
export const SEPOLIA_USDC =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address;

export const registrarAbi = [
  {
    type: "function",
    name: "isAvailable",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getRegisterPrice",
    stateMutability: "view",
    inputs: [
      { name: "label", type: "string" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
    ],
    outputs: [
      { name: "base", type: "uint256" },
      { name: "premium", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_COMMITMENT_AGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
] as const;
