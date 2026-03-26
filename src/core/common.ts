import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import readline from "readline";
import chalk from "chalk";

import { getConnection } from "./connection.js";
import { logSuccess, logInfo, logSection } from "../display/progress.js";

// ── Keypair loading ──────────────────────────────────────────

export function loadKeypair(keypairPath?: string): Keypair {
  const resolved = keypairPath || path.join(
    process.env.HOME || "~",
    ".config/solana/id.json",
  );

  try {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    throw new Error(`Cannot load keypair from ${resolved}`);
  }
}

// ── Confirmation prompt ──────────────────────────────────────

export function prompt(question: string): Promise<string> {
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

export async function confirmProceed(message: string): Promise<boolean> {
  const answer = await prompt(`\n  ${message} (y/n): `);
  return answer.trim().toLowerCase() === "y";
}

// ── Dry-run summary ──────────────────────────────────────────

export interface DryRunTransfer {
  wallet: string;
  amount: string;
  mint?: string;
}

export function printDryRunSummary(
  transfers: DryRunTransfer[],
  opts: {
    type: "token" | "sol";
    totalAmount: string;
    estimatedTxs: number;
    estimatedCU: number;
    cluster: string;
  },
) {
  logSection("DRY RUN — No transactions will be sent");

  console.log(chalk.yellow(`
  ┌─────────────────────────────────────────────────────────┐
  │  Cluster:          ${opts.cluster.padEnd(38)}│
  │  Recipients:       ${String(transfers.length).padEnd(38)}│
  │  Total ${opts.type === "sol" ? "SOL" : "tokens"}:      ${opts.totalAmount.padEnd(38)}│
  │  Est. transactions: ${String(opts.estimatedTxs).padEnd(37)}│
  │  Est. compute:     ${opts.estimatedCU.toLocaleString().padEnd(38)}│
  └─────────────────────────────────────────────────────────┘`));

  // Show first 10 recipients
  const preview = transfers.slice(0, 10);
  console.log(chalk.dim("\n  Recipients preview:"));
  for (const t of preview) {
    const walletShort = `${t.wallet.slice(0, 8)}...${t.wallet.slice(-4)}`;
    const mintInfo = t.mint ? ` (${t.mint.slice(0, 8)}...)` : "";
    console.log(chalk.dim(`    ${walletShort}  →  ${t.amount}${mintInfo}`));
  }
  if (transfers.length > 10) {
    console.log(chalk.dim(`    ... and ${transfers.length - 10} more\n`));
  }
}

// ── Token balance check ──────────────────────────────────────

export async function checkTokenBalance(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  requiredAmount: bigint,
): Promise<{ balance: bigint; sourceATA: PublicKey }> {
  const sourceATA = await getAssociatedTokenAddress(mint, payer);
  const account = await connection.getAccountInfo(sourceATA);

  if (!account) {
    throw new Error(
      `Source token account not found. Make sure your wallet has tokens for mint ${mint.toBase58()}`,
    );
  }

  const tokenAccount = await getAccount(connection, sourceATA);
  const balance = tokenAccount.amount;

  if (balance < requiredAmount) {
    throw new Error(
      `Insufficient token balance. Need ${requiredAmount.toString()}, have ${balance.toString()}`,
    );
  }

  return { balance, sourceATA };
}

// ── Max cost check ───────────────────────────────────────────

export function checkMaxCost(
  estimatedCostSol: number,
  maxCostSol: number | undefined,
) {
  if (maxCostSol !== undefined && estimatedCostSol > maxCostSol) {
    throw new Error(
      `Estimated cost (~${estimatedCostSol.toFixed(4)} SOL) exceeds --max-cost limit (${maxCostSol} SOL). Aborting.`,
    );
  }
}

// ── Receipt/log output ───────────────────────────────────────

export interface ReceiptEntry {
  wallet: string;
  amount: string;
  mint?: string;
  signature: string;
  status: "success" | "failed";
}

export interface Receipt {
  timestamp: string;
  cluster: string;
  payer: string;
  command: string;
  transfers: ReceiptEntry[];
  summary: {
    totalTransfers: number;
    successCount: number;
    failedCount: number;
    totalCU: number;
    txCount: number;
    wallTimeMs: number;
  };
}

export function saveReceipt(receipt: Receipt, outputPath?: string): string {
  const filePath = outputPath || `pdrop-receipt-${Date.now()}.json`;
  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2));
  return filePath;
}

export function saveReceiptCsv(entries: ReceiptEntry[], outputPath: string): string {
  const header = "wallet,amount,mint,signature,status";
  const rows = entries.map((e) =>
    `${e.wallet},${e.amount},${e.mint || ""},${e.signature},${e.status}`,
  );
  fs.writeFileSync(outputPath, [header, ...rows].join("\n"));
  return outputPath;
}

// ── Webhook notification ─────────────────────────────────────

export async function sendWebhook(url: string, receipt: Receipt): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
    });
    if (response.ok) {
      logSuccess(`Webhook sent to ${url}`);
    } else {
      console.log(chalk.yellow(`  ⚠ Webhook returned ${response.status}`));
    }
  } catch (err: any) {
    console.log(chalk.yellow(`  ⚠ Webhook failed: ${err.message}`));
  }
}

// ── Progress bar ─────────────────────────────────────────────

export function progressBar(current: number, total: number, width = 30): string {
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = Math.round(ratio * 100);
  return `[${bar}] ${pct}% | ${current}/${total}`;
}

// ── Resume state ─────────────────────────────────────────────

export interface ResumeState {
  command: string;
  cluster: string;
  mint?: string;
  recipients: { wallet: string; amount: string }[];
  completedIndices: number[];
  signatures: string[];
  timestamp: string;
}

const RESUME_FILE = ".pdrop-resume.json";

export function saveResumeState(state: ResumeState): void {
  fs.writeFileSync(RESUME_FILE, JSON.stringify(state, null, 2));
}

export function loadResumeState(): ResumeState | null {
  if (!fs.existsSync(RESUME_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function clearResumeState(): void {
  if (fs.existsSync(RESUME_FILE)) {
    fs.unlinkSync(RESUME_FILE);
  }
}

// ── Estimate costs ───────────────────────────────────────────

export function estimateAirdropCost(recipientCount: number): {
  ptokenCU: number;
  splCU: number;
  estimatedTxs: number;
  estimatedSolCost: number;
} {
  const ptokenCUPerTransfer = 78;
  const splCUPerTransfer = 4_645;

  // With ALT: 60 per tx, without: 20 per tx
  const useALT = recipientCount > 20;
  const perTx = useALT ? 60 : 20;
  const estimatedTxs = Math.ceil(recipientCount / perTx);

  // Each tx costs ~5000 lamports base + ~200 per CU
  const ptokenCU = recipientCount * ptokenCUPerTransfer;
  const splCU = recipientCount * splCUPerTransfer;

  // Rough SOL cost: tx fees + ATA creation (if needed) + ALT creation
  const txFeeSol = estimatedTxs * 0.000005;
  const altCostSol = useALT ? 0.003 : 0;
  const estimatedSolCost = txFeeSol + altCostSol;

  return { ptokenCU, splCU, estimatedTxs, estimatedSolCost };
}
