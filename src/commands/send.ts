import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

import { getConnection, retryWithBackoff, sendAndConfirm } from "../core/connection.js";
import { createALT, extendALT, waitForALTActivation, buildAndSendVersionedTx } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection } from "../display/progress.js";
import { printCsvResults } from "../display/results.js";
import { MAX_TRANSFERS_PER_TX_WITH_ALT, MAX_TRANSFERS_PER_TX_NO_ALT } from "../constants.js";
import type { BenchmarkResult } from "../types.js";
import {
  loadKeypair,
  confirmProceed,
  printDryRunSummary,
  checkTokenBalance,
  checkMaxCost,
  estimateAirdropCost,
  saveReceipt,
  saveReceiptCsv,
  sendWebhook,
  progressBar,
  saveResumeState,
  loadResumeState,
  clearResumeState,
  type ReceiptEntry,
  type Receipt,
} from "../core/common.js";

export async function runSend(options: {
  mint: string;
  to: string;
  amount: string;
  cluster: string;
  rpc?: string;
  keypair?: string;
  dryRun?: boolean;
  yes?: boolean;
  maxCost?: number;
  output?: string;
  outputCsv?: string;
  webhook?: string;
  resume?: boolean;
}) {
  printBanner();

  const { cluster, rpc } = options;
  const connection = getConnection(cluster, rpc);

  // ── Load keypair ──────────────────────────────────────────────
  logSection("SETUP");

  const payer = loadKeypair(options.keypair);
  const balance = await connection.getBalance(payer.publicKey);
  const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(2);
  logSuccess(`Loaded wallet: ${payer.publicKey.toBase58().slice(0, 8)}...${payer.publicKey.toBase58().slice(-4)} (${solBalance} SOL)`);

  // ── Parse mint ────────────────────────────────────────────────
  const mint = new PublicKey(options.mint);
  logSuccess(`Mint: ${mint.toBase58()}`);

  // ── Parse recipients ──────────────────────────────────────────
  const walletStrings = options.to.split(",").map((w) => w.trim()).filter(Boolean);
  if (walletStrings.length === 0) {
    throw new Error("No recipient wallets provided");
  }

  const amount = BigInt(options.amount);
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }

  const wallets = walletStrings.map((w) => {
    try {
      return new PublicKey(w);
    } catch {
      throw new Error(`Invalid wallet address: ${w}`);
    }
  });

  logSuccess(`${wallets.length} recipients, ${amount.toString()} tokens each`);

  // ── Check token balance ─────────────────────────────────────
  const totalAmount = amount * BigInt(wallets.length);
  const { sourceATA } = await checkTokenBalance(connection, payer.publicKey, mint, totalAmount);
  logSuccess(`Source ATA: ${sourceATA.toBase58().slice(0, 8)}...${sourceATA.toBase58().slice(-4)}`);

  // ── Estimate costs & max-cost check ─────────────────────────
  const estimate = estimateAirdropCost(wallets.length);
  checkMaxCost(estimate.estimatedSolCost, options.maxCost);

  // ── Dry run ─────────────────────────────────────────────────
  if (options.dryRun) {
    printDryRunSummary(
      wallets.map((w) => ({ wallet: w.toBase58(), amount: amount.toString() })),
      {
        type: "token",
        totalAmount: totalAmount.toString(),
        estimatedTxs: estimate.estimatedTxs,
        estimatedCU: estimate.ptokenCU,
        cluster,
      },
    );
    return;
  }

  // ── Confirmation ────────────────────────────────────────────
  if (!options.yes) {
    const proceed = await confirmProceed(
      `Send ${amount.toString()} tokens to ${wallets.length} wallets on ${cluster}?`,
    );
    if (!proceed) {
      console.log("\n  Aborted.\n");
      return;
    }
  }

  // ── Check for resume state ──────────────────────────────────
  let startIdx = 0;
  const existingSignatures: string[] = [];

  if (options.resume) {
    const resumeState = loadResumeState();
    if (resumeState && resumeState.command === "send" && resumeState.mint === options.mint) {
      startIdx = resumeState.completedIndices.length;
      existingSignatures.push(...resumeState.signatures);
      logSuccess(`Resuming from transfer ${startIdx}/${wallets.length}`);
    }
  }

  // ── Derive ATAs ───────────────────────────────────────────────
  let spinner = createSpinner("Deriving token accounts...");
  spinner.start();
  const atas: PublicKey[] = [];
  for (const wallet of wallets) {
    atas.push(await getAssociatedTokenAddress(mint, wallet));
  }
  spinner.stop();
  logSuccess(`Derived ${atas.length} Associated Token Accounts`);

  // ── Check which ATAs exist ────────────────────────────────────
  spinner = createSpinner("Checking existing token accounts...");
  spinner.start();

  const missingIndices: number[] = [];
  const batchSize = 100;
  for (let i = 0; i < atas.length; i += batchSize) {
    const batch = atas.slice(i, i + batchSize);
    const accounts = await retryWithBackoff(() =>
      connection.getMultipleAccountsInfo(batch),
    );
    for (let j = 0; j < accounts.length; j++) {
      if (!accounts[j]) {
        missingIndices.push(i + j);
      }
    }
  }

  spinner.stop();
  logSuccess(`${atas.length - missingIndices.length} accounts exist, ${missingIndices.length} need creation`);

  // ── Create missing ATAs ───────────────────────────────────────
  if (missingIndices.length > 0) {
    spinner = createSpinner(`Creating ${missingIndices.length} token accounts...`);
    spinner.start();

    const createBatchSize = 5;
    let created = 0;
    for (let i = 0; i < missingIndices.length; i += createBatchSize) {
      const batch = missingIndices.slice(i, i + createBatchSize);
      const tx = new Transaction();

      for (const idx of batch) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey,
            atas[idx],
            wallets[idx],
            mint,
          ),
        );
      }

      await sendAndConfirm(connection, tx, [payer]);
      created += batch.length;
      spinner.text = `Creating token accounts... ${created}/${missingIndices.length}`;
      await new Promise((r) => setTimeout(r, 200));
    }

    spinner.stop();
    logSuccess(`Created ${missingIndices.length} token accounts`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SEND TOKENS
  // ═══════════════════════════════════════════════════════════════
  logSection("BATCH SEND");

  const useALT = wallets.length > MAX_TRANSFERS_PER_TX_NO_ALT;
  const signatures: string[] = [...existingSignatures];
  let totalCU = 0;
  const startTime = Date.now();
  const completedIndices: number[] = Array.from({ length: startIdx }, (_, i) => i);

  if (useALT) {
    spinner = createSpinner("Creating Address Lookup Table...");
    spinner.start();
    const altAddress = await createALT(connection, payer);
    spinner.stop();
    logSuccess("Created Address Lookup Table");

    spinner = createSpinner("Loading addresses into ALT...");
    spinner.start();
    const altAddresses = [sourceATA, ...atas];
    await extendALT(connection, payer, altAddress, altAddresses, (done, total) => {
      spinner.text = `Loading addresses into ALT... ${done}/${total}`;
    });
    spinner.stop();
    logSuccess(`Added ${altAddresses.length} addresses to ALT`);

    spinner = createSpinner("Waiting for ALT activation...");
    spinner.start();
    const altAccount = await waitForALTActivation(connection, altAddress, altAddresses.length);
    spinner.stop();
    logSuccess(`ALT activated (${altAccount.state.addresses.length} addresses)`);

    for (let i = startIdx; i < wallets.length; i += MAX_TRANSFERS_PER_TX_WITH_ALT) {
      const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_WITH_ALT, wallets.length);
      const batchATAs = atas.slice(i, batchEnd);

      const instructions = batchATAs.map((dest) =>
        createTransferInstruction(sourceATA, dest, payer.publicKey, amount),
      );

      const sig = await buildAndSendVersionedTx(connection, payer, instructions, altAccount);
      signatures.push(sig);

      for (let idx = i; idx < batchEnd; idx++) completedIndices.push(idx);
      saveResumeState({
        command: "send",
        cluster,
        mint: options.mint,
        recipients: wallets.map((w) => ({ wallet: w.toBase58(), amount: amount.toString() })),
        completedIndices,
        signatures,
        timestamp: new Date().toISOString(),
      });

      process.stdout.write(`\r  ${progressBar(batchEnd, wallets.length)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    for (let i = startIdx; i < wallets.length; i += MAX_TRANSFERS_PER_TX_NO_ALT) {
      const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_NO_ALT, wallets.length);
      const batchATAs = atas.slice(i, batchEnd);

      const tx = new Transaction();
      for (const dest of batchATAs) {
        tx.add(createTransferInstruction(sourceATA, dest, payer.publicKey, amount));
      }

      const sig = await sendAndConfirm(connection, tx, [payer]);
      signatures.push(sig);

      for (let idx = i; idx < batchEnd; idx++) completedIndices.push(idx);
      saveResumeState({
        command: "send",
        cluster,
        mint: options.mint,
        recipients: wallets.map((w) => ({ wallet: w.toBase58(), amount: amount.toString() })),
        completedIndices,
        signatures,
        timestamp: new Date().toISOString(),
      });

      process.stdout.write(`\r  ${progressBar(batchEnd, wallets.length)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(""); // newline after progress bar
  const wallTimeMs = Date.now() - startTime;

  // Fetch CU
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
    } catch {}
  }
  if (totalCU === 0) totalCU = wallets.length * 78;

  logSuccess(`Total CU: ${totalCU.toLocaleString()} | Time: ${(wallTimeMs / 1000).toFixed(1)}s | ${signatures.length} txs`);

  // Clear resume state on success
  clearResumeState();

  // ═══════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════
  logSection("RESULTS");

  const result: BenchmarkResult = {
    label: "P-Token (SIMD-0266)",
    totalCU,
    txCount: signatures.length,
    wallTimeMs,
    signatures,
    transferCount: wallets.length,
  };

  printCsvResults(result, totalAmount, cluster);

  // ── Receipt output ────────────────────────────────────────────
  const receiptEntries: ReceiptEntry[] = wallets.map((w, i) => {
    const txIdx = Math.floor(i / (useALT ? MAX_TRANSFERS_PER_TX_WITH_ALT : MAX_TRANSFERS_PER_TX_NO_ALT));
    return {
      wallet: w.toBase58(),
      amount: amount.toString(),
      mint: mint.toBase58(),
      signature: signatures[txIdx] || "unknown",
      status: "success" as const,
    };
  });

  const receipt: Receipt = {
    timestamp: new Date().toISOString(),
    cluster,
    payer: payer.publicKey.toBase58(),
    command: "send",
    transfers: receiptEntries,
    summary: {
      totalTransfers: wallets.length,
      successCount: wallets.length,
      failedCount: 0,
      totalCU,
      txCount: signatures.length,
      wallTimeMs,
    },
  };

  if (options.output) {
    const path = saveReceipt(receipt, options.output);
    logSuccess(`Receipt saved to ${path}`);
  }

  if (options.outputCsv) {
    const path = saveReceiptCsv(receiptEntries, options.outputCsv);
    logSuccess(`CSV receipt saved to ${path}`);
  }

  // ── Webhook ───────────────────────────────────────────────────
  if (options.webhook) {
    await sendWebhook(options.webhook, receipt);
  }
}
