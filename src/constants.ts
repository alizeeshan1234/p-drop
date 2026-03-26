import { PublicKey } from "@solana/web3.js";

// SIMD-0266 feature gate program (routes transfers through P-Token)
export const SIMD0266_PROGRAM = new PublicKey("7GJmXtGkAWcKY8bZFmPvYc9XZqbfND9YoA9zwQrkCfxA");

// P-Token program (Pinocchio-based SPL Token replacement)
export const PTOKEN_PROGRAM = new PublicKey("ptokFjwyJtrwCa9Kgo9xoDS59V4QccBGEaRFnRPnSdP");

// Standard SPL Token program (runs P-Token code when SIMD-0266 is active)
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Instruction discriminators
export const BATCH_DISCRIMINATOR = 26;
export const TRANSFER_DISCRIMINATOR = 3;

// Transaction packing limits
export const MAX_TRANSFERS_PER_TX_NO_ALT = 20;
export const MAX_TRANSFERS_PER_TX_WITH_ALT = 60;
export const MAX_ALT_EXTEND_PER_TX = 30;
export const TX_SIZE_LIMIT = 1232;

// Token defaults for demo mode
export const DEMO_DECIMALS = 6;
export const DEMO_AMOUNT_PER_RECIPIENT = 1_000_000; // 1 token (6 decimals)
export const DEMO_MINT_AMOUNT = 1_000_000_000_000; // 1M tokens
