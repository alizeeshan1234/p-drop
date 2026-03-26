#!/usr/bin/env node
import { Command } from "commander";
import { runDemo } from "../src/commands/demo.js";
import { runCsv } from "../src/commands/csv.js";

const program = new Command();

program
  .name("pdrop")
  .description("Airdrop tool powered by P-Token (SIMD-0266) — 98% cheaper than SPL Token")
  .version("1.0.0");

program
  .command("demo")
  .description("Run a live SPL Token vs P-Token airdrop comparison")
  .option("-n, --recipients <number>", "Number of recipients", "20")
  .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
  .option("--rpc <url>", "Custom RPC endpoint")
  .option("--keypair <path>", "Path to keypair file")
  .action(async (opts) => {
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

program
  .command("csv")
  .description("Airdrop tokens to wallets from a CSV file")
  .requiredOption("-m, --mint <address>", "Token mint address")
  .requiredOption("-f, --csv <path>", "Path to CSV file (wallet,amount)")
  .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
  .option("--rpc <url>", "Custom RPC endpoint")
  .option("--keypair <path>", "Path to keypair file")
  .action(async (opts) => {
    try {
      await runCsv({
        mint: opts.mint,
        csv: opts.csv,
        cluster: opts.cluster,
        rpc: opts.rpc,
        keypair: opts.keypair,
      });
    } catch (err: any) {
      console.error("\nError:", err.message);
      process.exit(1);
    }
  });

program.parse();
