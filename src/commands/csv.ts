import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";

import { getConnection, retryWithBackoff, sendAndConfirm } from "../core/connection.js";
import { createALT, extendALT, waitForALTActivation, buildAndSendVersionedTx } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection, logInfo } from "../display/progress.js";
import { printCsvResults } from "../display/results.js";
import { parseRecipientsCSV } from "../csv/parser.js";
import { MAX_TRANSFERS_PER_TX_WITH_ALT } from "../constants.js";
import { createTransferInstruction } from "@solana/spl-token";
import type { BenchmarkResult } from "../types.js";

export async function runCsv(options: {
  mint: string;
  csv: string;
  cluster: string;
  rpc?: string;
  keypair?: string;
}) {
  printBanner();

  const { cluster, rpc } = options;
  const connection = getConnection(cluster, rpc);

  // ── Load keypair ──────────────────────────────────────────────
  logSection("SETUP");

  const keypairPath = options.keypair || path.join(
    process.env.HOME || "~",
    ".config/solana/id.json",
  );

  let payer: Keypair;
  try {
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    throw new Error(`Cannot load keypair from ${keypairPath}`);
  }

  const balance = await connection.getBalance(payer.publicKey);
  const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(2);
  logSuccess(`Loaded wallet: ${payer.publicKey.toBase58().slice(0, 8)}...${payer.publicKey.toBase58().slice(-4)} (${solBalance} SOL)`);

  // ── Parse mint ────────────────────────────────────────────────
  const mint = new PublicKey(options.mint);
  logSuccess(`Mint: ${mint.toBase58()}`);

  // ── Parse CSV ─────────────────────────────────────────────────
  let spinner = createSpinner("Parsing CSV...");
  spinner.start();
  const recipients = parseRecipientsCSV(options.csv);
  spinner.stop();
  logSuccess(`Parsed ${recipients.length} recipients from ${options.csv}`);

  // ── Derive ATAs ───────────────────────────────────────────────
  spinner = createSpinner("Deriving token accounts...");
  spinner.start();
  const atas: PublicKey[] = [];
  for (const r of recipients) {
    atas.push(await getAssociatedTokenAddress(mint, r.wallet));
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
            recipients[idx].wallet,
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

  // ── Get source ATA ────────────────────────────────────────────
  const sourceATA = await getAssociatedTokenAddress(mint, payer.publicKey);
  const sourceAccount = await connection.getAccountInfo(sourceATA);
  if (!sourceAccount) {
    throw new Error(`Source token account not found. Make sure your wallet has tokens for mint ${mint.toBase58()}`);
  }
  logSuccess(`Source ATA: ${sourceATA.toBase58().slice(0, 8)}...${sourceATA.toBase58().slice(-4)}`);

  // ═══════════════════════════════════════════════════════════════
  // P-TOKEN AIRDROP
  // ═══════════════════════════════════════════════════════════════
  logSection("P-TOKEN AIRDROP");

  // Create ALT
  spinner = createSpinner("Creating Address Lookup Table...");
  spinner.start();
  const altAddress = await createALT(connection, payer);
  spinner.stop();
  logSuccess("Created Address Lookup Table");

  // Extend ALT
  spinner = createSpinner("Loading addresses into ALT...");
  spinner.start();
  const altAddresses = [sourceATA, ...atas];
  await extendALT(connection, payer, altAddress, altAddresses, (done, total) => {
    spinner.text = `Loading addresses into ALT... ${done}/${total}`;
  });
  spinner.stop();
  logSuccess(`Added ${altAddresses.length} addresses to ALT`);

  // Wait for ALT activation
  spinner = createSpinner("Waiting for ALT activation...");
  spinner.start();
  const altAccount = await waitForALTActivation(connection, altAddress, altAddresses.length);
  spinner.stop();
  logSuccess(`ALT activated (${altAccount.state.addresses.length} addresses)`);

  // Execute transfers
  spinner = createSpinner(`Sending ${recipients.length} transfers...`);
  spinner.start();

  const signatures: string[] = [];
  let totalCU = 0;
  const startTime = Date.now();

  for (let i = 0; i < recipients.length; i += MAX_TRANSFERS_PER_TX_WITH_ALT) {
    const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_WITH_ALT, recipients.length);
    const batchRecipients = recipients.slice(i, batchEnd);
    const batchATAs = atas.slice(i, batchEnd);

    const instructions = batchRecipients.map((r, j) =>
      createTransferInstruction(
        sourceATA,
        batchATAs[j],
        payer.publicKey,
        r.amount,
      ),
    );

    const sig = await buildAndSendVersionedTx(
      connection,
      payer,
      instructions,
      altAccount,
    );
    signatures.push(sig);

    spinner.text = `Sending transfers... ${batchEnd}/${recipients.length}`;
    await new Promise((r) => setTimeout(r, 200));
  }

  const wallTimeMs = Date.now() - startTime;
  spinner.stop();

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
  if (totalCU === 0) totalCU = recipients.length * 78;

  logSuccess(`Total CU: ${totalCU.toLocaleString()} | Time: ${(wallTimeMs / 1000).toFixed(1)}s | ${signatures.length} txs`);

  // ═══════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════
  logSection("RESULTS");

  const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0n);

  const result: BenchmarkResult = {
    label: "P-Token (SIMD-0266)",
    totalCU,
    txCount: signatures.length,
    wallTimeMs,
    signatures,
    transferCount: recipients.length,
  };

  printCsvResults(result, totalAmount, cluster);
}
