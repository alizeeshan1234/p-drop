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
import fs from "fs";

import { getConnection, retryWithBackoff, sendAndConfirm } from "../core/connection.js";
import { createALT, extendALT, waitForALTActivation, buildAndSendVersionedTx } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection } from "../display/progress.js";
import { printMultiTokenResults } from "../display/results.js";
import { MAX_TRANSFERS_PER_TX_NO_ALT, MAX_TRANSFERS_PER_TX_WITH_ALT } from "../constants.js";
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
  type ReceiptEntry,
  type Receipt,
} from "../core/common.js";

interface TokenTransfer {
  mint: PublicKey;
  wallet: PublicKey;
  amount: bigint;
}

function parseTransfersJson(filePath: string): TokenTransfer[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("JSON file must contain an array of transfers");
  }

  return data.map((entry: any, i: number) => {
    if (!entry.mint || !entry.wallet || !entry.amount) {
      throw new Error(`Transfer at index ${i} missing required fields (mint, wallet, amount)`);
    }

    let mint: PublicKey;
    try {
      mint = new PublicKey(entry.mint);
    } catch {
      throw new Error(`Invalid mint address at index ${i}: ${entry.mint}`);
    }

    let wallet: PublicKey;
    try {
      wallet = new PublicKey(entry.wallet);
    } catch {
      throw new Error(`Invalid wallet address at index ${i}: ${entry.wallet}`);
    }

    const amount = BigInt(entry.amount);
    if (amount <= 0n) {
      throw new Error(`Amount must be positive at index ${i}`);
    }

    return { mint, wallet, amount };
  });
}

export async function runMultiSend(options: {
  file: string;
  cluster: string;
  rpc?: string;
  keypair?: string;
  dryRun?: boolean;
  yes?: boolean;
  maxCost?: number;
  output?: string;
  outputCsv?: string;
  webhook?: string;
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

  // ── Parse transfers file ──────────────────────────────────────
  let spinner = createSpinner("Parsing transfers file...");
  spinner.start();
  const transfers = parseTransfersJson(options.file);
  spinner.stop();
  logSuccess(`Parsed ${transfers.length} transfers from ${options.file}`);

  // Group by mint
  const mintGroups = new Map<string, TokenTransfer[]>();
  for (const t of transfers) {
    const key = t.mint.toBase58();
    if (!mintGroups.has(key)) mintGroups.set(key, []);
    mintGroups.get(key)!.push(t);
  }

  for (const [mint, group] of mintGroups) {
    logSuccess(`  ${mint.slice(0, 8)}...${mint.slice(-4)}: ${group.length} recipients`);
  }

  // ── Check token balances for all mints ──────────────────────
  for (const [mintStr, group] of mintGroups) {
    const mint = new PublicKey(mintStr);
    const totalForMint = group.reduce((sum, t) => sum + t.amount, 0n);
    await checkTokenBalance(connection, payer.publicKey, mint, totalForMint);
  }
  logSuccess("Token balances verified for all mints");

  // ── Estimate costs & max-cost check ─────────────────────────
  const estimate = estimateAirdropCost(transfers.length);
  checkMaxCost(estimate.estimatedSolCost, options.maxCost);

  // ── Dry run ─────────────────────────────────────────────────
  if (options.dryRun) {
    printDryRunSummary(
      transfers.map((t) => ({
        wallet: t.wallet.toBase58(),
        amount: t.amount.toString(),
        mint: t.mint.toBase58(),
      })),
      {
        type: "token",
        totalAmount: `${transfers.length} transfers across ${mintGroups.size} mints`,
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
      `Send ${transfers.length} transfers across ${mintGroups.size} mints on ${cluster}?`,
    );
    if (!proceed) {
      console.log("\n  Aborted.\n");
      return;
    }
  }

  // ── Process each mint group ───────────────────────────────────
  const allSignatures: string[] = [];
  const allReceiptEntries: ReceiptEntry[] = [];
  let grandTotalCU = 0;
  const grandStartTime = Date.now();

  for (const [mintStr, group] of mintGroups) {
    const mint = new PublicKey(mintStr);
    logSection(`SENDING ${mintStr.slice(0, 8)}...${mintStr.slice(-4)}`);

    // Derive ATAs
    spinner = createSpinner("Deriving token accounts...");
    spinner.start();
    const atas: PublicKey[] = [];
    for (const t of group) {
      atas.push(await getAssociatedTokenAddress(mint, t.wallet));
    }
    spinner.stop();
    logSuccess(`Derived ${atas.length} ATAs`);

    // Check which ATAs exist
    spinner = createSpinner("Checking existing token accounts...");
    spinner.start();

    const missingIndices: number[] = [];
    const checkBatchSize = 100;
    for (let i = 0; i < atas.length; i += checkBatchSize) {
      const batch = atas.slice(i, i + checkBatchSize);
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
    logSuccess(`${atas.length - missingIndices.length} exist, ${missingIndices.length} need creation`);

    // Create missing ATAs
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
              group[idx].wallet,
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

    // Get source ATA
    const sourceATA = await getAssociatedTokenAddress(mint, payer.publicKey);

    // Execute transfers
    const useALT = group.length > MAX_TRANSFERS_PER_TX_NO_ALT;
    const signatures: string[] = [];

    if (useALT) {
      spinner = createSpinner("Setting up Address Lookup Table...");
      spinner.start();
      const altAddress = await createALT(connection, payer);
      const altAddresses = [sourceATA, ...atas];
      await extendALT(connection, payer, altAddress, altAddresses);
      const altAccount = await waitForALTActivation(connection, altAddress, altAddresses.length);
      spinner.stop();
      logSuccess("ALT ready");

      for (let i = 0; i < group.length; i += MAX_TRANSFERS_PER_TX_WITH_ALT) {
        const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_WITH_ALT, group.length);
        const batchGroup = group.slice(i, batchEnd);
        const batchATAs = atas.slice(i, batchEnd);

        const instructions = batchGroup.map((t, j) =>
          createTransferInstruction(sourceATA, batchATAs[j], payer.publicKey, t.amount),
        );

        const sig = await buildAndSendVersionedTx(connection, payer, instructions, altAccount);
        signatures.push(sig);

        process.stdout.write(`\r  ${progressBar(batchEnd, group.length)}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    } else {
      for (let i = 0; i < group.length; i += MAX_TRANSFERS_PER_TX_NO_ALT) {
        const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_NO_ALT, group.length);
        const batchGroup = group.slice(i, batchEnd);
        const batchATAs = atas.slice(i, batchEnd);

        const tx = new Transaction();
        for (let j = 0; j < batchGroup.length; j++) {
          tx.add(createTransferInstruction(sourceATA, batchATAs[j], payer.publicKey, batchGroup[j].amount));
        }

        const sig = await sendAndConfirm(connection, tx, [payer]);
        signatures.push(sig);

        process.stdout.write(`\r  ${progressBar(batchEnd, group.length)}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log("");
    allSignatures.push(...signatures);

    // Fetch CU
    await new Promise((r) => setTimeout(r, 1500));
    let mintCU = 0;
    for (const sig of signatures) {
      try {
        const txInfo = await retryWithBackoff(() =>
          connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }),
        );
        if (txInfo?.meta?.computeUnitsConsumed) {
          mintCU += txInfo.meta.computeUnitsConsumed;
        }
      } catch {}
    }
    if (mintCU === 0) mintCU = group.length * 78;
    grandTotalCU += mintCU;

    logSuccess(`${group.length} transfers done | ${mintCU.toLocaleString()} CU | ${signatures.length} txs`);

    // Build receipt entries for this mint group
    for (let i = 0; i < group.length; i++) {
      const batchPerTx = useALT ? MAX_TRANSFERS_PER_TX_WITH_ALT : MAX_TRANSFERS_PER_TX_NO_ALT;
      const txIdx = Math.floor(i / batchPerTx);
      allReceiptEntries.push({
        wallet: group[i].wallet.toBase58(),
        amount: group[i].amount.toString(),
        mint: mintStr,
        signature: signatures[txIdx] || "unknown",
        status: "success",
      });
    }
  }

  const grandWallTimeMs = Date.now() - grandStartTime;

  // ═══════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════
  logSection("RESULTS");

  printMultiTokenResults({
    totalTransfers: transfers.length,
    mintCount: mintGroups.size,
    totalCU: grandTotalCU,
    txCount: allSignatures.length,
    wallTimeMs: grandWallTimeMs,
    signatures: allSignatures,
    cluster,
  });

  // ── Receipt output ────────────────────────────────────────────
  const receipt: Receipt = {
    timestamp: new Date().toISOString(),
    cluster,
    payer: payer.publicKey.toBase58(),
    command: "multi-send",
    transfers: allReceiptEntries,
    summary: {
      totalTransfers: transfers.length,
      successCount: transfers.length,
      failedCount: 0,
      totalCU: grandTotalCU,
      txCount: allSignatures.length,
      wallTimeMs: grandWallTimeMs,
    },
  };

  if (options.output) {
    const path = saveReceipt(receipt, options.output);
    logSuccess(`Receipt saved to ${path}`);
  }

  if (options.outputCsv) {
    const path = saveReceiptCsv(allReceiptEntries, options.outputCsv);
    logSuccess(`CSV receipt saved to ${path}`);
  }

  if (options.webhook) {
    await sendWebhook(options.webhook, receipt);
  }
}
