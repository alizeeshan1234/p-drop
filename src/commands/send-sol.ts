import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";

import { getConnection, retryWithBackoff, sendAndConfirm } from "../core/connection.js";
import { createALT, extendALT, waitForALTActivation, buildAndSendVersionedTx } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection } from "../display/progress.js";
import { printSolResults } from "../display/results.js";
import {
  loadKeypair,
  confirmProceed,
  printDryRunSummary,
  checkMaxCost,
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

export async function runSendSol(options: {
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

  // ── Parse recipients ──────────────────────────────────────────
  const walletStrings = options.to.split(",").map((w) => w.trim()).filter(Boolean);
  if (walletStrings.length === 0) {
    throw new Error("No recipient wallets provided");
  }

  const amountLamports = BigInt(Math.round(parseFloat(options.amount) * LAMPORTS_PER_SOL));
  if (amountLamports <= 0n) {
    throw new Error("Amount must be positive");
  }

  const wallets = walletStrings.map((w) => {
    try {
      return new PublicKey(w);
    } catch {
      throw new Error(`Invalid wallet address: ${w}`);
    }
  });

  const totalSol = parseFloat(options.amount) * wallets.length;
  logSuccess(`${wallets.length} recipients, ${options.amount} SOL each (${totalSol.toFixed(4)} SOL total)`);

  // ── Check sufficient balance ──────────────────────────────────
  const requiredLamports = amountLamports * BigInt(wallets.length);
  if (BigInt(balance) < requiredLamports + BigInt(LAMPORTS_PER_SOL / 100)) {
    throw new Error(`Insufficient balance. Need ~${(Number(requiredLamports) / LAMPORTS_PER_SOL + 0.01).toFixed(4)} SOL, have ${solBalance} SOL`);
  }

  // ── Max-cost check ────────────────────────────────────────────
  checkMaxCost(totalSol, options.maxCost);

  // ── Dry run ─────────────────────────────────────────────────
  if (options.dryRun) {
    const estimatedTxs = Math.ceil(wallets.length / 21);
    printDryRunSummary(
      wallets.map((w) => ({ wallet: w.toBase58(), amount: options.amount + " SOL" })),
      {
        type: "sol",
        totalAmount: totalSol.toFixed(4) + " SOL",
        estimatedTxs,
        estimatedCU: wallets.length * 150,
        cluster,
      },
    );
    return;
  }

  // ── Confirmation ────────────────────────────────────────────
  if (!options.yes) {
    const proceed = await confirmProceed(
      `Send ${options.amount} SOL to ${wallets.length} wallets on ${cluster}? (${totalSol.toFixed(4)} SOL total)`,
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
    if (resumeState && resumeState.command === "send-sol") {
      startIdx = resumeState.completedIndices.length;
      existingSignatures.push(...resumeState.signatures);
      logSuccess(`Resuming from transfer ${startIdx}/${wallets.length}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH SEND SOL
  // ═══════════════════════════════════════════════════════════════
  logSection("BATCH SEND SOL");

  const maxPerTx = 21;
  const useALT = wallets.length > maxPerTx;
  const signatures: string[] = [...existingSignatures];
  let totalCU = 0;
  const startTime = Date.now();
  const completedIndices: number[] = Array.from({ length: startIdx }, (_, i) => i);

  let spinner: ReturnType<typeof createSpinner>;

  if (useALT) {
    spinner = createSpinner("Creating Address Lookup Table...");
    spinner.start();
    const altAddress = await createALT(connection, payer);
    spinner.stop();
    logSuccess("Created Address Lookup Table");

    spinner = createSpinner("Loading addresses into ALT...");
    spinner.start();
    await extendALT(connection, payer, altAddress, wallets, (done, total) => {
      spinner.text = `Loading addresses into ALT... ${done}/${total}`;
    });
    spinner.stop();
    logSuccess(`Added ${wallets.length} addresses to ALT`);

    spinner = createSpinner("Waiting for ALT activation...");
    spinner.start();
    const altAccount = await waitForALTActivation(connection, altAddress, wallets.length);
    spinner.stop();
    logSuccess(`ALT activated (${altAccount.state.addresses.length} addresses)`);

    const altBatchSize = 40;

    for (let i = startIdx; i < wallets.length; i += altBatchSize) {
      const batchEnd = Math.min(i + altBatchSize, wallets.length);
      const batch = wallets.slice(i, batchEnd);

      const instructions = batch.map((dest) =>
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: dest,
          lamports: amountLamports,
        }),
      );

      const sig = await buildAndSendVersionedTx(connection, payer, instructions, altAccount);
      signatures.push(sig);

      for (let idx = i; idx < batchEnd; idx++) completedIndices.push(idx);
      saveResumeState({
        command: "send-sol",
        cluster,
        recipients: wallets.map((w) => ({ wallet: w.toBase58(), amount: options.amount })),
        completedIndices,
        signatures,
        timestamp: new Date().toISOString(),
      });

      process.stdout.write(`\r  ${progressBar(batchEnd, wallets.length)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    for (let i = startIdx; i < wallets.length; i += maxPerTx) {
      const batchEnd = Math.min(i + maxPerTx, wallets.length);
      const batch = wallets.slice(i, batchEnd);

      const tx = new Transaction();
      for (const dest of batch) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: dest,
            lamports: amountLamports,
          }),
        );
      }

      const sig = await sendAndConfirm(connection, tx, [payer]);
      signatures.push(sig);

      for (let idx = i; idx < batchEnd; idx++) completedIndices.push(idx);
      saveResumeState({
        command: "send-sol",
        cluster,
        recipients: wallets.map((w) => ({ wallet: w.toBase58(), amount: options.amount })),
        completedIndices,
        signatures,
        timestamp: new Date().toISOString(),
      });

      process.stdout.write(`\r  ${progressBar(batchEnd, wallets.length)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log("");
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
  if (totalCU === 0) totalCU = wallets.length * 150;

  logSuccess(`Total CU: ${totalCU.toLocaleString()} | Time: ${(wallTimeMs / 1000).toFixed(1)}s | ${signatures.length} txs`);

  // Clear resume state on success
  clearResumeState();

  // ═══════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════
  logSection("RESULTS");

  printSolResults({
    transferCount: wallets.length,
    totalSol,
    totalCU,
    txCount: signatures.length,
    wallTimeMs,
    signatures,
    cluster,
  });

  // ── Receipt output ────────────────────────────────────────────
  const receiptEntries: ReceiptEntry[] = wallets.map((w, i) => {
    const txIdx = Math.floor(i / (useALT ? 40 : maxPerTx));
    return {
      wallet: w.toBase58(),
      amount: options.amount + " SOL",
      signature: signatures[txIdx] || "unknown",
      status: "success" as const,
    };
  });

  const receipt: Receipt = {
    timestamp: new Date().toISOString(),
    cluster,
    payer: payer.publicKey.toBase58(),
    command: "send-sol",
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

  if (options.webhook) {
    await sendWebhook(options.webhook, receipt);
  }
}
