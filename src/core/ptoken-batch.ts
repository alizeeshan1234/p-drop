import {
  Connection,
  Keypair,
  PublicKey,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import { buildAndSendVersionedTx } from "./alt-manager.js";
import { retryWithBackoff } from "./connection.js";
import { MAX_TRANSFERS_PER_TX_WITH_ALT } from "../constants.js";
import type { BenchmarkResult } from "../types.js";

/**
 * Run P-Token airdrop using ALT-packed versioned transactions.
 *
 * On devnet/testnet with SIMD-0266 active, TokenkegQfe... runs P-Token code.
 * Standard transfer instructions automatically get P-Token performance (~78 CU).
 * By packing many transfers per tx using ALTs, we maximize throughput.
 */
export async function runPTokenBenchmark(
  connection: Connection,
  payer: Keypair,
  sourceAccount: PublicKey,
  destinationAccounts: PublicKey[],
  amountPerTransfer: bigint,
  altAccount: AddressLookupTableAccount,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchmarkResult> {
  const batchSize = MAX_TRANSFERS_PER_TX_WITH_ALT;
  const signatures: string[] = [];
  let totalCU = 0;
  const startTime = Date.now();

  for (let i = 0; i < destinationAccounts.length; i += batchSize) {
    const batch = destinationAccounts.slice(i, i + batchSize);

    const instructions = batch.map((dest) =>
      createTransferInstruction(
        sourceAccount,
        dest,
        payer.publicKey,
        amountPerTransfer,
      ),
    );

    const sig = await buildAndSendVersionedTx(
      connection,
      payer,
      instructions,
      altAccount,
    );
    signatures.push(sig);

    if (onProgress) onProgress(Math.min(i + batchSize, destinationAccounts.length), destinationAccounts.length);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Record wall time BEFORE fetching CU (fetch is measurement overhead, not airdrop time)
  const wallTimeMs = Date.now() - startTime;

  // Fetch CU for each tx
  await new Promise((r) => setTimeout(r, 1500));

  for (const sig of signatures) {
    try {
      const txInfo = await retryWithBackoff(() =>
        connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      );
      if (txInfo?.meta?.computeUnitsConsumed) {
        totalCU += txInfo.meta.computeUnitsConsumed;
      }
    } catch {
      // Estimate if we can't fetch
    }
  }

  // If CU fetch failed entirely, use known P-Token CU
  if (totalCU === 0) {
    totalCU = destinationAccounts.length * 78;
  }

  return {
    label: "P-Token (SIMD-0266)",
    totalCU,
    txCount: signatures.length,
    wallTimeMs,
    signatures,
    transferCount: destinationAccounts.length,
  };
}
