#!/usr/bin/env node
import { Command } from "commander";
import { runDemo } from "../src/commands/demo.js";
import { runCsv } from "../src/commands/csv.js";
import { runAirdrop } from "../src/commands/airdrop.js";
import { runSend } from "../src/commands/send.js";
import { runSendSol } from "../src/commands/send-sol.js";
import { runMultiSend } from "../src/commands/multi-send.js";
import { runEstimate } from "../src/commands/estimate.js";

const program = new Command();

program
  .name("pdrop")
  .description("Airdrop & batch send tool powered by P-Token (SIMD-0266) — 98% cheaper than SPL Token")
  .version("1.1.0");

// ── Shared option helpers ─────────────────────────────────────

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .option("--rpc <url>", "Custom RPC endpoint")
    .option("--keypair <path>", "Path to keypair file");
}

function addSendOptions(cmd: Command): Command {
  return cmd
    .option("--dry-run", "Preview what will happen without sending transactions")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--max-cost <sol>", "Abort if estimated cost exceeds this SOL amount", parseFloat)
    .option("-o, --output <path>", "Save receipt as JSON file")
    .option("--output-csv <path>", "Save receipt as CSV file")
    .option("--webhook <url>", "POST results to a webhook URL when done")
    .option("--resume", "Resume a previously failed operation");
}

// ── Demo ──────────────────────────────────────────────────────

addCommonOptions(
  program
    .command("demo")
    .description("Run a live SPL Token vs P-Token airdrop comparison")
    .option("-n, --recipients <number>", "Number of recipients", "20"),
).action(async (opts) => {
  try {
    await runDemo({
      recipients: parseInt(opts.recipients, 10),
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── CSV Airdrop ───────────────────────────────────────────────

addSendOptions(
  addCommonOptions(
    program
      .command("csv")
      .description("Airdrop tokens to wallets from a CSV file")
      .requiredOption("-m, --mint <address>", "Token mint address")
      .requiredOption("-f, --csv <path>", "Path to CSV file (wallet,amount)"),
  ),
).action(async (opts) => {
  try {
    await runCsv({
      mint: opts.mint,
      csv: opts.csv,
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
      dryRun: opts.dryRun,
      yes: opts.yes,
      maxCost: opts.maxCost,
      output: opts.output,
      outputCsv: opts.outputCsv,
      webhook: opts.webhook,
      resume: opts.resume,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── Interactive Airdrop ───────────────────────────────────────

addCommonOptions(
  program
    .command("airdrop")
    .description("Interactive airdrop — choose snapshot, CSV, or manual entry"),
).action(async (opts) => {
  try {
    await runAirdrop({
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── Batch Send (inline token transfers) ───────────────────────

addSendOptions(
  addCommonOptions(
    program
      .command("send")
      .description("Send tokens to multiple wallets inline (no CSV needed)")
      .requiredOption("-m, --mint <address>", "Token mint address")
      .requiredOption("-t, --to <wallets>", "Comma-separated wallet addresses")
      .requiredOption("-a, --amount <amount>", "Token amount per recipient (raw units)"),
  ),
).action(async (opts) => {
  try {
    await runSend({
      mint: opts.mint,
      to: opts.to,
      amount: opts.amount,
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
      dryRun: opts.dryRun,
      yes: opts.yes,
      maxCost: opts.maxCost,
      output: opts.output,
      outputCsv: opts.outputCsv,
      webhook: opts.webhook,
      resume: opts.resume,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── Batch Send SOL ────────────────────────────────────────────

addSendOptions(
  addCommonOptions(
    program
      .command("send-sol")
      .description("Send SOL to multiple wallets in batched transactions")
      .requiredOption("-t, --to <wallets>", "Comma-separated wallet addresses")
      .requiredOption("-a, --amount <sol>", "SOL amount per recipient"),
  ),
).action(async (opts) => {
  try {
    await runSendSol({
      to: opts.to,
      amount: opts.amount,
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
      dryRun: opts.dryRun,
      yes: opts.yes,
      maxCost: opts.maxCost,
      output: opts.output,
      outputCsv: opts.outputCsv,
      webhook: opts.webhook,
      resume: opts.resume,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── Multi-Token Batch Send ────────────────────────────────────

addSendOptions(
  addCommonOptions(
    program
      .command("multi-send")
      .description("Send different tokens to different wallets from a JSON file")
      .requiredOption("-f, --file <path>", "Path to JSON file with transfers"),
  ),
).action(async (opts) => {
  try {
    await runMultiSend({
      file: opts.file,
      cluster: opts.cluster,
      rpc: opts.rpc,
      keypair: opts.keypair,
      dryRun: opts.dryRun,
      yes: opts.yes,
      maxCost: opts.maxCost,
      output: opts.output,
      outputCsv: opts.outputCsv,
      webhook: opts.webhook,
    });
  } catch (err: any) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
});

// ── Estimate ──────────────────────────────────────────────────

program
  .command("estimate")
  .description("Estimate airdrop costs — P-Token vs SPL Token comparison")
  .requiredOption("-n, --recipients <number>", "Number of recipients")
  .action(async (opts) => {
    try {
      await runEstimate({
        recipients: parseInt(opts.recipients, 10),
      });
    } catch (err: any) {
      console.error("\nError:", err.message);
      process.exit(1);
    }
  });

program.parse();
