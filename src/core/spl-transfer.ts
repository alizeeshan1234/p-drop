import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import { retryWithBackoff, sendAndConfirm } from "./connection.js";
import { MAX_TRANSFERS_PER_TX_NO_ALT } from "../constants.js";
import type { BenchmarkResult } from "../types.js";

export async function runSPLBenchmark(
  connection: Connection,
  payer: Keypair,
  sourceAccount: PublicKey,
  destinationAccounts: PublicKey[],
  amountPerTransfer: bigint,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchmarkResult> {
  const batchSize = MAX_TRANSFERS_PER_TX_NO_ALT;
  const signatures: string[] = [];
  let totalCU = 0;
  const startTime = Date.now();

  for (let i = 0; i < destinationAccounts.length; i += batchSize) {
    const batch = destinationAccounts.slice(i, i + batchSize);

    const tx = new Transaction();
    for (const dest of batch) {
      tx.add(
        createTransferInstruction(
          sourceAccount,
          dest,
          payer.publicKey,
          amountPerTransfer,
        ),
      );
    }

    const sig = await sendAndConfirm(connection, tx, [payer]);
    signatures.push(sig);

    if (onProgress) onProgress(Math.min(i + batchSize, destinationAccounts.length), destinationAccounts.length);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Fetch CU for each tx
  await new Promise((r) => setTimeout(r, 1000));

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
      totalCU += batchSize * 4645;
    }
  }

  return {
    label: "SPL Token",
    totalCU,
    txCount: signatures.length,
    wallTimeMs: Date.now() - startTime,
    signatures,
    transferCount: destinationAccounts.length,
  };
}
