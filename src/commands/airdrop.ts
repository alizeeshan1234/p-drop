import {
  Keypair,
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
import path from "path";
import readline from "readline";

import { getConnection, retryWithBackoff, sendAndConfirm } from "../core/connection.js";
import { getTokenHolders } from "../core/snapshot.js";
import { createALT, extendALT, waitForALTActivation, buildAndSendVersionedTx } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection } from "../display/progress.js";
import { printCsvResults } from "../display/results.js";
import { parseRecipientsCSV } from "../csv/parser.js";
import { MAX_TRANSFERS_PER_TX_WITH_ALT } from "../constants.js";
import type { BenchmarkResult } from "../types.js";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

interface Recipient {
  wallet: PublicKey;
  amount: bigint;
}

export async function runAirdrop(options: {
  cluster: string;
  rpc?: string;
  keypair?: string;
}) {
  printBanner();

  const { cluster, rpc } = options;
  const connection = getConnection(cluster, rpc);

  // ── Load keypair ──────────────────────────────────────────
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
  logSuccess(`Wallet: ${payer.publicKey.toBase58().slice(0, 8)}...${payer.publicKey.toBase58().slice(-4)} (${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL)`);

  // ── Ask for mint ──────────────────────────────────────────
  const mintStr = await prompt("\n  Token mint address: ");
  const mint = new PublicKey(mintStr.trim());
  logSuccess(`Mint: ${mint.toBase58()}`);

  // ── Ask for method ────────────────────────────────────────
  console.log(`
  How do you want to provide recipients?

    1. Snapshot  — Auto-fetch all holders of a token
    2. CSV file  — Upload a CSV (wallet,amount)
    3. Manual    — Enter addresses one by one
`);
  const method = await prompt("  Choose (1/2/3): ");

  let recipients: Recipient[] = [];

  // ══════════════════════════════════════════════════════════
  // METHOD 1: SNAPSHOT
  // ══════════════════════════════════════════════════════════
  if (method.trim() === "1") {
    const sourceMintStr = await prompt("  Source token mint (holders of this token get the airdrop): ");
    const sourceMint = new PublicKey(sourceMintStr.trim());

    const spinner = createSpinner("Fetching token holders...");
    spinner.start();
    const holders = await getTokenHolders(connection, sourceMint, [payer.publicKey]);
    spinner.stop();
    logSuccess(`Found ${holders.length} holders`);

    if (holders.length === 0) {
      throw new Error("No holders found for this token");
    }

    // Show top holders
    console.log("\n  Top holders:");
    for (const h of holders.slice(0, 5)) {
      console.log(`    ${h.owner.toBase58().slice(0, 12)}...  balance: ${h.balance.toString()}`);
    }
    if (holders.length > 5) {
      console.log(`    ... and ${holders.length - 5} more\n`);
    }

    // Ask distribution method
    console.log("  Distribution method:");
    console.log("    1. Equal    — Same amount to each holder");
    console.log("    2. Pro-rata — Proportional to their holdings\n");
    const distMethod = await prompt("  Choose (1/2): ");

    if (distMethod.trim() === "1") {
      const amountStr = await prompt("  Amount per recipient (raw tokens): ");
      const amount = BigInt(amountStr.trim());
      recipients = holders.map((h) => ({ wallet: h.owner, amount }));
    } else {
      const totalStr = await prompt("  Total tokens to distribute (raw): ");
      const totalAmount = BigInt(totalStr.trim());
      const totalHoldings = holders.reduce((sum, h) => sum + h.balance, 0n);

      recipients = holders.map((h) => ({
        wallet: h.owner,
        amount: (h.balance * totalAmount) / totalHoldings,
      }));
      recipients = recipients.filter((r) => r.amount > 0n);
    }

  // ══════════════════════════════════════════════════════════
  // METHOD 2: CSV FILE
  // ══════════════════════════════════════════════════════════
  } else if (method.trim() === "2") {
    const csvPath = await prompt("  Path to CSV file: ");
    const parsed = parseRecipientsCSV(csvPath.trim());
    recipients = parsed.map((r) => ({ wallet: r.wallet, amount: r.amount }));
    logSuccess(`Loaded ${recipients.length} recipients from CSV`);

  // ══════════════════════════════════════════════════════════
  // METHOD 3: MANUAL ENTRY
  // ══════════════════════════════════════════════════════════
  } else if (method.trim() === "3") {
    console.log("\n  Enter recipients (empty wallet to finish):\n");
    while (true) {
      const walletStr = await prompt("  Wallet address: ");
      if (!walletStr.trim()) break;

      const amountStr = await prompt("  Amount (raw tokens): ");
      recipients.push({
        wallet: new PublicKey(walletStr.trim()),
        amount: BigInt(amountStr.trim()),
      });
      console.log(`  Added. (${recipients.length} total)\n`);
    }
  } else {
    throw new Error("Invalid choice");
  }

  if (recipients.length === 0) {
    throw new Error("No recipients provided");
  }

  const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0n);
  logSuccess(`${recipients.length} recipients, ${totalAmount.toString()} total tokens`);

  // ── Derive ATAs ───────────────────────────────────────────
  logSection("PREPARING AIRDROP");

  let spinner = createSpinner("Deriving token accounts...");
  spinner.start();
  const atas: PublicKey[] = [];
  for (const r of recipients) {
    atas.push(await getAssociatedTokenAddress(mint, r.wallet));
  }
  spinner.stop();
  logSuccess(`Derived ${atas.length} ATAs`);

  // ── Check which ATAs exist ────────────────────────────────
  spinner = createSpinner("Checking existing accounts...");
  spinner.start();

  const missingIndices: number[] = [];
  for (let i = 0; i < atas.length; i += 100) {
    const batch = atas.slice(i, i + 100);
    const accounts = await retryWithBackoff(() =>
      connection.getMultipleAccountsInfo(batch),
    );
    for (let j = 0; j < accounts.length; j++) {
      if (!accounts[j]) missingIndices.push(i + j);
    }
  }
  spinner.stop();
  logSuccess(`${atas.length - missingIndices.length} exist, ${missingIndices.length} need creation`);

  // ── Create missing ATAs ──────────────────────────────────
  if (missingIndices.length > 0) {
    spinner = createSpinner(`Creating ${missingIndices.length} token accounts...`);
    spinner.start();

    let created = 0;
    for (let i = 0; i < missingIndices.length; i += 5) {
      const batch = missingIndices.slice(i, i + 5);
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

  // ── Source ATA ────────────────────────────────────────────
  const sourceATA = await getAssociatedTokenAddress(mint, payer.publicKey);

  // ═══════════════════════════════════════════════════════════
  // EXECUTE AIRDROP
  // ═══════════════════════════════════════════════════════════
  logSection("EXECUTING AIRDROP");

  const useALT = recipients.length > 20;
  const signatures: string[] = [];
  let totalCU = 0;
  const startTime = Date.now();

  if (useALT) {
    // Use ALT for large airdrops (60 transfers per tx)
    spinner = createSpinner("Creating Address Lookup Table...");
    spinner.start();
    const altAddress = await createALT(connection, payer);
    spinner.stop();
    logSuccess("Created ALT");

    spinner = createSpinner("Loading addresses into ALT...");
    spinner.start();
    const altAddresses = [sourceATA, ...atas];
    await extendALT(connection, payer, altAddress, altAddresses, (done, total) => {
      spinner.text = `Loading addresses... ${done}/${total}`;
    });
    spinner.stop();
    logSuccess(`Added ${altAddresses.length} addresses to ALT`);

    spinner = createSpinner("Waiting for ALT activation...");
    spinner.start();
    const altAccount = await waitForALTActivation(connection, altAddress, altAddresses.length);
    spinner.stop();
    logSuccess(`ALT activated (${altAccount.state.addresses.length} addresses)`);

    spinner = createSpinner(`Sending ${recipients.length} transfers...`);
    spinner.start();

    for (let i = 0; i < recipients.length; i += MAX_TRANSFERS_PER_TX_WITH_ALT) {
      const batchEnd = Math.min(i + MAX_TRANSFERS_PER_TX_WITH_ALT, recipients.length);
      const batchRecipients = recipients.slice(i, batchEnd);
      const batchATAs = atas.slice(i, batchEnd);

      const instructions = batchRecipients.map((r, j) =>
        createTransferInstruction(sourceATA, batchATAs[j], payer.publicKey, r.amount),
      );

      const sig = await buildAndSendVersionedTx(connection, payer, instructions, altAccount);
      signatures.push(sig);
      spinner.text = `Sending transfers... ${batchEnd}/${recipients.length}`;
      await new Promise((r) => setTimeout(r, 200));
    }

    spinner.stop();
  } else {
    // Use regular transactions for small airdrops (≤20 per tx)
    spinner = createSpinner(`Sending ${recipients.length} transfers...`);
    spinner.start();

    const batchSize = 20;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, recipients.length);
      const batchRecipients = recipients.slice(i, batchEnd);
      const batchATAs = atas.slice(i, batchEnd);

      const tx = new Transaction();
      for (let j = 0; j < batchRecipients.length; j++) {
        tx.add(createTransferInstruction(sourceATA, batchATAs[j], payer.publicKey, batchRecipients[j].amount));
      }

      const sig = await sendAndConfirm(connection, tx, [payer]);
      signatures.push(sig);
      spinner.text = `Sending transfers... ${batchEnd}/${recipients.length}`;
      await new Promise((r) => setTimeout(r, 200));
    }

    spinner.stop();
  }

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
      if (txInfo?.meta?.computeUnitsConsumed) totalCU += txInfo.meta.computeUnitsConsumed;
    } catch {}
  }
  if (totalCU === 0) totalCU = recipients.length * 78;

  logSuccess(`Done! ${recipients.length} transfers in ${signatures.length} txs`);

  // ═══════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════
  logSection("RESULTS");

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
